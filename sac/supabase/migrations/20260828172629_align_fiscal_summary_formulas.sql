ALTER TABLE public.received_invoices
  DROP CONSTRAINT IF EXISTS received_invoices_partial_deductibility_config_check;
ALTER TABLE public.received_invoices
  ADD CONSTRAINT received_invoices_partial_deductibility_config_check
  CHECK (
    deductible_status <> 'PARTIALLY_DEDUCTIBLE'
    OR deductibility_percent IS NOT NULL
    OR deductibility_limit IS NOT NULL
  );

CREATE OR REPLACE VIEW public.fiscal_monthly_summary
WITH (security_invoker = true)
AS
WITH tx_base AS (
    SELECT
        ft.id,
        ft.owner_user_id,
        ft.transaction_date,
        date_trunc('month', ft.transaction_date::timestamp)::date AS month_start,
        EXTRACT(YEAR FROM ft.transaction_date)::int AS year,
        EXTRACT(MONTH FROM ft.transaction_date)::int AS month,
        ft.direction,
        ft.transaction_type,
        ft.amount,
        ft.fiscal_treatment,
        ft.deductibility_percent,
        ft.deductibility_limit,
        ft.created_at
    FROM public.financial_transactions ft
    WHERE ft.status = 'CONFIRMED'
),
tx_fiscal AS (
    SELECT
        t.owner_user_id,
        t.month_start,
        t.year,
        t.month,
        CASE
            WHEN t.transaction_type = 'RECEIPT' AND t.direction = 'IN' THEN t.amount
            WHEN t.fiscal_treatment = 'INCOME' THEN CASE WHEN t.direction='IN' THEN t.amount ELSE -t.amount END
            WHEN t.transaction_type = 'REFUND_OUT' AND t.direction = 'OUT' AND t.fiscal_treatment IS NULL THEN -t.amount
            ELSE 0::numeric
        END AS income,
        CASE
            WHEN t.transaction_type <> 'PAYMENT' AND t.fiscal_treatment = 'DEDUCTIBLE_EXPENSE' THEN
                (CASE WHEN t.direction='OUT' THEN 1 ELSE -1 END) *
                LEAST(
                    ROUND(t.amount * COALESCE(t.deductibility_percent,100) / 100.0, 2),
                    COALESCE(t.deductibility_limit, ROUND(t.amount * COALESCE(t.deductibility_percent,100) / 100.0, 2))
                )
            ELSE 0::numeric
        END AS manual_deductible,
        CASE
            WHEN t.transaction_type <> 'PAYMENT' AND t.fiscal_treatment = 'DEDUCTIBLE_EXPENSE' THEN
                (CASE WHEN t.direction='OUT' THEN 1 ELSE -1 END) *
                GREATEST(
                    t.amount - LEAST(
                        ROUND(t.amount * COALESCE(t.deductibility_percent,100) / 100.0, 2),
                        COALESCE(t.deductibility_limit, ROUND(t.amount * COALESCE(t.deductibility_percent,100) / 100.0, 2))
                    ),
                    0
                )
            WHEN t.transaction_type <> 'PAYMENT' AND t.fiscal_treatment = 'NON_DEDUCTIBLE_EXPENSE' THEN
                CASE WHEN t.direction='OUT' THEN t.amount ELSE -t.amount END
            ELSE 0::numeric
        END AS manual_non_deductible,
        CASE WHEN t.transaction_type='OWN_CONTRIBUTION' THEN t.amount ELSE 0::numeric END AS owner_contributions,
        CASE WHEN t.transaction_type='OWN_CONTRIBUTION_RETURN' THEN t.amount ELSE 0::numeric END AS owner_withdrawals
    FROM tx_base t
),
payment_base AS (
    SELECT
        ft.owner_user_id,
        ft.transaction_date,
        date_trunc('month', ft.transaction_date::timestamp)::date AS month_start,
        EXTRACT(YEAR FROM ft.transaction_date)::int AS year,
        EXTRACT(MONTH FROM ft.transaction_date)::int AS month,
        ft.created_at AS transaction_created_at,
        ta.id AS allocation_id,
        ta.created_at AS allocation_created_at,
        ta.received_invoice_id,
        ta.allocated_amount,
        ri.deductible_status,
        ri.deductibility_percent,
        ri.deductibility_limit,
        CASE
            WHEN ri.deductible_status = 'DEDUCTIBLE' THEN
                ROUND(ta.allocated_amount * COALESCE(ri.deductibility_percent,100) / 100.0, 2)
            WHEN ri.deductible_status = 'PARTIALLY_DEDUCTIBLE' THEN
                ROUND(ta.allocated_amount * COALESCE(ri.deductibility_percent,100) / 100.0, 2)
            ELSE 0::numeric
        END AS candidate_deductible
    FROM public.financial_transactions ft
    JOIN public.transaction_allocations ta ON ta.transaction_id = ft.id
    JOIN public.received_invoices ri ON ri.id = ta.received_invoice_id
    WHERE ft.status='CONFIRMED'
      AND ft.direction='OUT'
      AND ft.transaction_type='PAYMENT'
),
payment_running AS (
    SELECT
        pb.*,
        COALESCE(
            SUM(pb.candidate_deductible) OVER (
                PARTITION BY pb.owner_user_id, pb.received_invoice_id
                ORDER BY pb.transaction_date, pb.transaction_created_at, pb.allocation_created_at, pb.allocation_id
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ),
            0::numeric
        ) AS previous_candidate
    FROM payment_base pb
),
payment_classified AS (
    SELECT
        pr.owner_user_id,
        pr.month_start,
        pr.year,
        pr.month,
        CASE
            WHEN pr.deductible_status IN ('DEDUCTIBLE','PARTIALLY_DEDUCTIBLE') THEN
                ROUND(
                    CASE
                        WHEN pr.deductibility_limit IS NULL THEN pr.candidate_deductible
                        ELSE GREATEST(
                            LEAST(pr.deductibility_limit, pr.previous_candidate + pr.candidate_deductible)
                            - LEAST(pr.deductibility_limit, pr.previous_candidate),
                            0
                        )
                    END,
                    2
                )
            ELSE 0::numeric
        END AS deductible_expense,
        CASE
            WHEN pr.deductible_status IN ('DEDUCTIBLE','PARTIALLY_DEDUCTIBLE') THEN
                ROUND(
                    pr.allocated_amount -
                    CASE
                        WHEN pr.deductibility_limit IS NULL THEN pr.candidate_deductible
                        ELSE GREATEST(
                            LEAST(pr.deductibility_limit, pr.previous_candidate + pr.candidate_deductible)
                            - LEAST(pr.deductibility_limit, pr.previous_candidate),
                            0
                        )
                    END,
                    2
                )
            WHEN pr.deductible_status = 'NON_DEDUCTIBLE' THEN pr.allocated_amount
            ELSE 0::numeric
        END AS non_deductible_expense
    FROM payment_running pr
),
depreciation AS (
    SELECT
        fa.owner_user_id,
        date_trunc('month', de.period::timestamp)::date AS month_start,
        EXTRACT(YEAR FROM de.period)::int AS year,
        EXTRACT(MONTH FROM de.period)::int AS month,
        SUM(de.amount) AS depreciation
    FROM public.fixed_asset_depreciation_entries de
    JOIN public.fixed_assets fa ON fa.id=de.fixed_asset_id
    WHERE fa.depreciation_start_date IS NULL
       OR de.period >= date_trunc('month', fa.depreciation_start_date::timestamp)::date
    GROUP BY fa.owner_user_id,
             date_trunc('month', de.period::timestamp)::date,
             EXTRACT(YEAR FROM de.period)::int,
             EXTRACT(MONTH FROM de.period)::int
),
events AS (
    SELECT owner_user_id, month_start, year, month,
           income,
           manual_deductible AS deductible_expenses,
           manual_non_deductible AS non_deductible_expenses,
           0::numeric AS depreciation,
           owner_contributions,
           owner_withdrawals
    FROM tx_fiscal
    UNION ALL
    SELECT owner_user_id, month_start, year, month,
           0::numeric,
           deductible_expense,
           non_deductible_expense,
           0::numeric,
           0::numeric,
           0::numeric
    FROM payment_classified
    UNION ALL
    SELECT owner_user_id, month_start, year, month,
           0::numeric,
           0::numeric,
           0::numeric,
           depreciation,
           0::numeric,
           0::numeric
    FROM depreciation
)
SELECT
    owner_user_id,
    month_start,
    year,
    month,
    ROUND(SUM(income),2) AS income,
    ROUND(SUM(deductible_expenses) + SUM(depreciation),2) AS deductible_expenses,
    ROUND(SUM(depreciation),2) AS depreciation,
    ROUND(SUM(non_deductible_expenses),2) AS non_deductible_expenses,
    ROUND(SUM(owner_contributions),2) AS owner_contributions,
    ROUND(SUM(owner_withdrawals),2) AS owner_withdrawals
FROM events
GROUP BY owner_user_id, month_start, year, month;

CREATE OR REPLACE FUNCTION public.get_fiscal_summary(
    p_year integer DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_income numeric := 0;
    v_deductible numeric := 0;
    v_non_deductible numeric := 0;
    v_depreciation numeric := 0;
    v_owner_contrib numeric := 0;
    v_owner_withdraw numeric := 0;
    v_cash_movement numeric := 0;
    v_net_income numeric := 0;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Utilizator neautentificat';
    END IF;

    SELECT
        COALESCE(SUM(fms.income),0),
        COALESCE(SUM(fms.deductible_expenses),0),
        COALESCE(SUM(fms.non_deductible_expenses),0),
        COALESCE(SUM(fms.depreciation),0),
        COALESCE(SUM(fms.owner_contributions),0),
        COALESCE(SUM(fms.owner_withdrawals),0)
    INTO v_income, v_deductible, v_non_deductible, v_depreciation,
         v_owner_contrib, v_owner_withdraw
    FROM public.fiscal_monthly_summary fms
    WHERE fms.owner_user_id=v_user_id
      AND fms.year=p_year;

    SELECT COALESCE(SUM(
        CASE WHEN ft.direction='IN' THEN ft.amount ELSE -ft.amount END
    ),0)
    INTO v_cash_movement
    FROM public.financial_transactions ft
    WHERE ft.owner_user_id=v_user_id
      AND ft.status='CONFIRMED'
      AND EXTRACT(YEAR FROM ft.transaction_date)::int=p_year
      AND ft.fiscal_treatment='CASH_MOVEMENT';

    v_net_income := v_income - v_deductible;

    RETURN jsonb_build_object(
        'year', p_year,
        'income', ROUND(v_income,2),
        'deductible_expenses', ROUND(v_deductible,2),
        'non_deductible_expenses', ROUND(v_non_deductible,2),
        'depreciation', ROUND(v_depreciation,2),
        'owner_contributions', ROUND(v_owner_contrib,2),
        'owner_withdrawals', ROUND(v_owner_withdraw,2),
        'cash_movements', ROUND(v_cash_movement,2),
        'net_income', ROUND(v_net_income,2)
    );
END;
$$;
