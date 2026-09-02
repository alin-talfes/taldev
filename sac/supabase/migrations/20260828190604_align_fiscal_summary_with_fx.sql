CREATE OR REPLACE VIEW public.fiscal_monthly_summary
WITH (security_invoker=true)
AS
WITH tx_base AS (
  SELECT ft.id,ft.owner_user_id,ft.transaction_date,date_trunc('month',ft.transaction_date::timestamp)::date AS month_start,
         EXTRACT(year FROM ft.transaction_date)::int AS year,EXTRACT(month FROM ft.transaction_date)::int AS month,
         ft.direction,ft.transaction_type,COALESCE(ft.amount_ron,ft.amount) AS amount_ron,
         ft.fiscal_treatment,ft.deductibility_percent,ft.deductibility_limit,
         COALESCE(ft.fx_cash_difference_ron,0) AS fx_cash_difference_ron,ft.fx_fiscal_treatment,ft.created_at
  FROM public.financial_transactions ft WHERE ft.status='CONFIRMED'
), tx_fiscal AS (
  SELECT t.owner_user_id,t.month_start,t.year,t.month,
    CASE WHEN t.transaction_type='RECEIPT' AND t.direction='IN' THEN t.amount_ron
         WHEN t.fiscal_treatment='INCOME' THEN CASE WHEN t.direction='IN' THEN t.amount_ron ELSE -t.amount_ron END
         WHEN t.transaction_type='REFUND_OUT' AND t.direction='OUT' AND t.fiscal_treatment IS NULL THEN -t.amount_ron
         ELSE 0 END
      + CASE WHEN t.fx_cash_difference_ron>0 AND t.fx_fiscal_treatment='INCOME' THEN t.fx_cash_difference_ron ELSE 0 END AS income,
    CASE WHEN t.transaction_type NOT IN ('PAYMENT','REFUND_IN') AND t.fiscal_treatment='DEDUCTIBLE_EXPENSE'
         THEN (CASE WHEN t.direction='OUT' THEN 1 ELSE -1 END)::numeric *
              LEAST(ROUND(t.amount_ron*COALESCE(t.deductibility_percent,100)/100.0,2),
                    COALESCE(t.deductibility_limit,ROUND(t.amount_ron*COALESCE(t.deductibility_percent,100)/100.0,2)))
         ELSE 0 END
      + CASE WHEN t.fx_cash_difference_ron<0 AND t.fx_fiscal_treatment='DEDUCTIBLE_EXPENSE' THEN ABS(t.fx_cash_difference_ron) ELSE 0 END AS manual_deductible,
    CASE WHEN t.transaction_type NOT IN ('PAYMENT','REFUND_IN') AND t.fiscal_treatment='DEDUCTIBLE_EXPENSE'
         THEN (CASE WHEN t.direction='OUT' THEN 1 ELSE -1 END)::numeric *
              GREATEST(t.amount_ron-LEAST(ROUND(t.amount_ron*COALESCE(t.deductibility_percent,100)/100.0,2),
                    COALESCE(t.deductibility_limit,ROUND(t.amount_ron*COALESCE(t.deductibility_percent,100)/100.0,2))),0)
         WHEN t.transaction_type NOT IN ('PAYMENT','REFUND_IN') AND t.fiscal_treatment='NON_DEDUCTIBLE_EXPENSE'
         THEN CASE WHEN t.direction='OUT' THEN t.amount_ron ELSE -t.amount_ron END
         ELSE 0 END
      + CASE WHEN t.fx_cash_difference_ron<0 AND t.fx_fiscal_treatment='NON_DEDUCTIBLE_EXPENSE' THEN ABS(t.fx_cash_difference_ron) ELSE 0 END AS manual_non_deductible,
    CASE WHEN t.transaction_type='OWN_CONTRIBUTION' THEN t.amount_ron ELSE 0 END AS owner_contributions,
    CASE WHEN t.transaction_type='OWN_CONTRIBUTION_RETURN' THEN t.amount_ron ELSE 0 END AS owner_withdrawals
  FROM tx_base t
), line_split AS (
  SELECT ri.id AS received_invoice_id,COALESCE(SUM(ril.total_amount),0) AS line_total,
         COALESCE(SUM(CASE WHEN ril.treatment='mijloc_fix' THEN ril.total_amount ELSE 0 END),0) AS capital_total
  FROM public.received_invoices ri LEFT JOIN public.received_invoice_lines ril ON ril.received_invoice_id=ri.id GROUP BY ri.id
), allocation_pre AS (
  SELECT ft.owner_user_id,ft.transaction_date,date_trunc('month',ft.transaction_date::timestamp)::date AS month_start,
         EXTRACT(year FROM ft.transaction_date)::int AS year,EXTRACT(month FROM ft.transaction_date)::int AS month,
         ft.created_at AS transaction_created_at,ta.id AS allocation_id,ta.created_at AS allocation_created_at,
         ta.received_invoice_id,
         CASE WHEN ft.direction='OUT' AND ft.transaction_type='PAYMENT' THEN ta.allocated_amount_ron
              WHEN ft.direction='IN' AND ft.transaction_type='REFUND_IN' THEN -ta.allocated_amount_ron ELSE NULL END AS signed_allocated,
         ri.deductible_status,ri.deductibility_percent,ri.deductibility_limit,
         CASE WHEN ls.line_total<>0 THEN ROUND((CASE WHEN ft.direction='OUT' AND ft.transaction_type='PAYMENT' THEN ta.allocated_amount_ron
              WHEN ft.direction='IN' AND ft.transaction_type='REFUND_IN' THEN -ta.allocated_amount_ron ELSE NULL END)*ls.capital_total/ls.line_total,2)
              ELSE 0 END AS capital_component
  FROM public.financial_transactions ft
  JOIN public.transaction_allocations ta ON ta.transaction_id=ft.id
  JOIN public.received_invoices ri ON ri.id=ta.received_invoice_id
  JOIN line_split ls ON ls.received_invoice_id=ri.id
  WHERE ft.status='CONFIRMED' AND ((ft.direction='OUT' AND ft.transaction_type='PAYMENT') OR (ft.direction='IN' AND ft.transaction_type='REFUND_IN'))
), allocation_base AS (
  SELECT ap.*,ROUND(ap.signed_allocated-ap.capital_component,2) AS expense_component,
         CASE WHEN ap.deductible_status IN ('DEDUCTIBLE','PARTIALLY_DEDUCTIBLE')
              THEN ROUND((ap.signed_allocated-ap.capital_component)*COALESCE(ap.deductibility_percent,100)/100.0,2) ELSE 0 END AS candidate_deductible
  FROM allocation_pre ap
), allocation_running AS (
  SELECT ab.*,COALESCE(SUM(ab.candidate_deductible) OVER (
    PARTITION BY ab.owner_user_id,ab.received_invoice_id ORDER BY ab.transaction_date,ab.transaction_created_at,ab.allocation_created_at,ab.allocation_id
    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS previous_candidate
  FROM allocation_base ab
), allocation_classified AS (
  SELECT ar.owner_user_id,ar.month_start,ar.year,ar.month,
    CASE WHEN ar.deductible_status IN ('DEDUCTIBLE','PARTIALLY_DEDUCTIBLE') THEN ROUND(
      CASE WHEN ar.deductibility_limit IS NULL
           THEN GREATEST(ar.previous_candidate+ar.candidate_deductible,0)-GREATEST(ar.previous_candidate,0)
           ELSE LEAST(ar.deductibility_limit,GREATEST(ar.previous_candidate+ar.candidate_deductible,0))-
                LEAST(ar.deductibility_limit,GREATEST(ar.previous_candidate,0)) END,2) ELSE 0 END AS deductible_expense,
    CASE WHEN ar.deductible_status IN ('DEDUCTIBLE','PARTIALLY_DEDUCTIBLE') THEN ROUND(ar.signed_allocated-
      CASE WHEN ar.deductibility_limit IS NULL
           THEN GREATEST(ar.previous_candidate+ar.candidate_deductible,0)-GREATEST(ar.previous_candidate,0)
           ELSE LEAST(ar.deductibility_limit,GREATEST(ar.previous_candidate+ar.candidate_deductible,0))-
                LEAST(ar.deductibility_limit,GREATEST(ar.previous_candidate,0)) END,2)
         WHEN ar.deductible_status='NON_DEDUCTIBLE' THEN ar.signed_allocated
         WHEN ar.deductible_status='NEEDS_VERIFICATION' THEN ar.capital_component ELSE 0 END AS non_deductible_expense
  FROM allocation_running ar
), depreciation AS (
  SELECT fa.owner_user_id,date_trunc('month',de.period::timestamp)::date AS month_start,
         EXTRACT(year FROM de.period)::int AS year,EXTRACT(month FROM de.period)::int AS month,SUM(de.amount) AS depreciation
  FROM public.fixed_asset_depreciation_entries de JOIN public.fixed_assets fa ON fa.id=de.fixed_asset_id
  WHERE fa.depreciation_start_date IS NULL OR de.period>=date_trunc('month',fa.depreciation_start_date::timestamp)::date
  GROUP BY fa.owner_user_id,date_trunc('month',de.period::timestamp)::date,EXTRACT(year FROM de.period)::int,EXTRACT(month FROM de.period)::int
), events AS (
  SELECT owner_user_id,month_start,year,month,income,manual_deductible AS deductible_expenses,
         manual_non_deductible AS non_deductible_expenses,0::numeric AS depreciation,owner_contributions,owner_withdrawals FROM tx_fiscal
  UNION ALL
  SELECT owner_user_id,month_start,year,month,0::numeric,deductible_expense,non_deductible_expense,0::numeric,0::numeric,0::numeric FROM allocation_classified
  UNION ALL
  SELECT owner_user_id,month_start,year,month,0::numeric,0::numeric,0::numeric,depreciation,0::numeric,0::numeric FROM depreciation
)
SELECT owner_user_id,month_start,year,month,ROUND(SUM(income),2) AS income,
       ROUND(SUM(deductible_expenses)+SUM(depreciation),2) AS deductible_expenses,
       ROUND(SUM(depreciation),2) AS depreciation,ROUND(SUM(non_deductible_expenses),2) AS non_deductible_expenses,
       ROUND(SUM(owner_contributions),2) AS owner_contributions,ROUND(SUM(owner_withdrawals),2) AS owner_withdrawals
FROM events GROUP BY owner_user_id,month_start,year,month;

CREATE OR REPLACE FUNCTION public.get_fiscal_summary(p_year integer DEFAULT EXTRACT(year FROM CURRENT_DATE)::integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid:=auth.uid();
  v_income numeric:=0; v_deductible numeric:=0; v_non_deductible numeric:=0; v_depreciation numeric:=0;
  v_owner_contrib numeric:=0; v_owner_withdraw numeric:=0; v_cash_movement numeric:=0; v_net_income numeric:=0;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Utilizator neautentificat'; END IF;
  SELECT COALESCE(SUM(fms.income),0),COALESCE(SUM(fms.deductible_expenses),0),COALESCE(SUM(fms.non_deductible_expenses),0),
         COALESCE(SUM(fms.depreciation),0),COALESCE(SUM(fms.owner_contributions),0),COALESCE(SUM(fms.owner_withdrawals),0)
  INTO v_income,v_deductible,v_non_deductible,v_depreciation,v_owner_contrib,v_owner_withdraw
  FROM public.fiscal_monthly_summary fms WHERE fms.owner_user_id=v_user_id AND fms.year=p_year;

  SELECT COALESCE(SUM(CASE WHEN ft.fiscal_treatment='CASH_MOVEMENT'
                               THEN CASE WHEN ft.direction='IN' THEN COALESCE(ft.amount_ron,ft.amount) ELSE -COALESCE(ft.amount_ron,ft.amount) END
                               ELSE 0 END),0)
       + COALESCE(SUM(CASE WHEN ft.fx_fiscal_treatment='CASH_MOVEMENT' THEN ft.fx_cash_difference_ron ELSE 0 END),0)
  INTO v_cash_movement
  FROM public.financial_transactions ft
  WHERE ft.owner_user_id=v_user_id AND ft.status='CONFIRMED' AND EXTRACT(YEAR FROM ft.transaction_date)::int=p_year;

  v_net_income:=v_income-v_deductible;
  RETURN jsonb_build_object('year',p_year,'income',ROUND(v_income,2),'deductible_expenses',ROUND(v_deductible,2),
    'non_deductible_expenses',ROUND(v_non_deductible,2),'depreciation',ROUND(v_depreciation,2),
    'owner_contributions',ROUND(v_owner_contrib,2),'owner_withdrawals',ROUND(v_owner_withdraw,2),
    'cash_movements',ROUND(v_cash_movement,2),'net_income',ROUND(v_net_income,2));
END;
$function$;
