CREATE OR REPLACE VIEW public.fiscal_monthly_summary
WITH (security_invoker = true)
AS
WITH tx_base AS (
    SELECT ft.id,ft.owner_user_id,ft.transaction_date,
           date_trunc('month',ft.transaction_date::timestamp)::date AS month_start,
           EXTRACT(YEAR FROM ft.transaction_date)::int AS year,
           EXTRACT(MONTH FROM ft.transaction_date)::int AS month,
           ft.direction,ft.transaction_type,ft.amount,ft.fiscal_treatment,
           ft.deductibility_percent,ft.deductibility_limit,ft.created_at
    FROM public.financial_transactions ft
    WHERE ft.status='CONFIRMED'
),
tx_fiscal AS (
    SELECT t.owner_user_id,t.month_start,t.year,t.month,
           CASE
             WHEN t.transaction_type='RECEIPT' AND t.direction='IN' THEN t.amount
             WHEN t.fiscal_treatment='INCOME' THEN CASE WHEN t.direction='IN' THEN t.amount ELSE -t.amount END
             WHEN t.transaction_type='REFUND_OUT' AND t.direction='OUT' AND t.fiscal_treatment IS NULL THEN -t.amount
             ELSE 0::numeric
           END AS income,
           CASE
             WHEN t.transaction_type NOT IN ('PAYMENT','REFUND_IN') AND t.fiscal_treatment='DEDUCTIBLE_EXPENSE' THEN
               (CASE WHEN t.direction='OUT' THEN 1 ELSE -1 END) *
               LEAST(ROUND(t.amount*COALESCE(t.deductibility_percent,100)/100.0,2),
                     COALESCE(t.deductibility_limit,ROUND(t.amount*COALESCE(t.deductibility_percent,100)/100.0,2)))
             ELSE 0::numeric
           END AS manual_deductible,
           CASE
             WHEN t.transaction_type NOT IN ('PAYMENT','REFUND_IN') AND t.fiscal_treatment='DEDUCTIBLE_EXPENSE' THEN
               (CASE WHEN t.direction='OUT' THEN 1 ELSE -1 END) *
               GREATEST(t.amount-LEAST(ROUND(t.amount*COALESCE(t.deductibility_percent,100)/100.0,2),
                     COALESCE(t.deductibility_limit,ROUND(t.amount*COALESCE(t.deductibility_percent,100)/100.0,2))),0)
             WHEN t.transaction_type NOT IN ('PAYMENT','REFUND_IN') AND t.fiscal_treatment='NON_DEDUCTIBLE_EXPENSE' THEN
               CASE WHEN t.direction='OUT' THEN t.amount ELSE -t.amount END
             ELSE 0::numeric
           END AS manual_non_deductible,
           CASE WHEN t.transaction_type='OWN_CONTRIBUTION' THEN t.amount ELSE 0::numeric END AS owner_contributions,
           CASE WHEN t.transaction_type='OWN_CONTRIBUTION_RETURN' THEN t.amount ELSE 0::numeric END AS owner_withdrawals
    FROM tx_base t
),
line_split AS (
    SELECT ri.id AS received_invoice_id,
           COALESCE(SUM(ril.total_amount),0)::numeric AS line_total,
           COALESCE(SUM(CASE WHEN ril.treatment='mijloc_fix' THEN ril.total_amount ELSE 0 END),0)::numeric AS capital_total
    FROM public.received_invoices ri
    LEFT JOIN public.received_invoice_lines ril ON ril.received_invoice_id=ri.id
    GROUP BY ri.id
),
allocation_pre AS (
    SELECT
        ft.owner_user_id,ft.transaction_date,
        date_trunc('month',ft.transaction_date::timestamp)::date AS month_start,
        EXTRACT(YEAR FROM ft.transaction_date)::int AS year,
        EXTRACT(MONTH FROM ft.transaction_date)::int AS month,
        ft.created_at AS transaction_created_at,
        ta.id AS allocation_id,ta.created_at AS allocation_created_at,
        ta.received_invoice_id,
        CASE
          WHEN ft.direction='OUT' AND ft.transaction_type='PAYMENT' THEN ta.allocated_amount
          WHEN ft.direction='IN' AND ft.transaction_type='REFUND_IN' THEN -ta.allocated_amount
        END AS signed_allocated,
        ri.deductible_status,ri.deductibility_percent,ri.deductibility_limit,
        CASE
          WHEN ls.line_total<>0 THEN ROUND(
            (CASE
              WHEN ft.direction='OUT' AND ft.transaction_type='PAYMENT' THEN ta.allocated_amount
              WHEN ft.direction='IN' AND ft.transaction_type='REFUND_IN' THEN -ta.allocated_amount
            END) * ls.capital_total/ls.line_total,2)
          ELSE 0::numeric
        END AS capital_component
    FROM public.financial_transactions ft
    JOIN public.transaction_allocations ta ON ta.transaction_id=ft.id
    JOIN public.received_invoices ri ON ri.id=ta.received_invoice_id
    JOIN line_split ls ON ls.received_invoice_id=ri.id
    WHERE ft.status='CONFIRMED'
      AND ((ft.direction='OUT' AND ft.transaction_type='PAYMENT')
        OR (ft.direction='IN' AND ft.transaction_type='REFUND_IN'))
),
allocation_base AS (
    SELECT ap.*,
           ROUND(ap.signed_allocated-ap.capital_component,2) AS expense_component,
           CASE
             WHEN ap.deductible_status IN ('DEDUCTIBLE','PARTIALLY_DEDUCTIBLE') THEN
               ROUND((ap.signed_allocated-ap.capital_component)*COALESCE(ap.deductibility_percent,100)/100.0,2)
             ELSE 0::numeric
           END AS candidate_deductible
    FROM allocation_pre ap
),
allocation_running AS (
    SELECT ab.*,
           COALESCE(SUM(ab.candidate_deductible) OVER (
             PARTITION BY ab.owner_user_id,ab.received_invoice_id
             ORDER BY ab.transaction_date,ab.transaction_created_at,ab.allocation_created_at,ab.allocation_id
             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           ),0::numeric) AS previous_candidate
    FROM allocation_base ab
),
allocation_classified AS (
    SELECT ar.owner_user_id,ar.month_start,ar.year,ar.month,
           CASE
             WHEN ar.deductible_status IN ('DEDUCTIBLE','PARTIALLY_DEDUCTIBLE') THEN
               ROUND(CASE WHEN ar.deductibility_limit IS NULL THEN
                   GREATEST(ar.previous_candidate+ar.candidate_deductible,0)-GREATEST(ar.previous_candidate,0)
                 ELSE
                   LEAST(ar.deductibility_limit,GREATEST(ar.previous_candidate+ar.candidate_deductible,0))
                   -LEAST(ar.deductibility_limit,GREATEST(ar.previous_candidate,0))
               END,2)
             ELSE 0::numeric
           END AS deductible_expense,
           CASE
             WHEN ar.deductible_status IN ('DEDUCTIBLE','PARTIALLY_DEDUCTIBLE') THEN
               ROUND(ar.signed_allocated-(CASE WHEN ar.deductibility_limit IS NULL THEN
                   GREATEST(ar.previous_candidate+ar.candidate_deductible,0)-GREATEST(ar.previous_candidate,0)
                 ELSE
                   LEAST(ar.deductibility_limit,GREATEST(ar.previous_candidate+ar.candidate_deductible,0))
                   -LEAST(ar.deductibility_limit,GREATEST(ar.previous_candidate,0))
               END),2)
             WHEN ar.deductible_status='NON_DEDUCTIBLE' THEN ar.signed_allocated
             WHEN ar.deductible_status='NEEDS_VERIFICATION' THEN ar.capital_component
             ELSE 0::numeric
           END AS non_deductible_expense
    FROM allocation_running ar
),
depreciation AS (
    SELECT fa.owner_user_id,date_trunc('month',de.period::timestamp)::date AS month_start,
           EXTRACT(YEAR FROM de.period)::int AS year,EXTRACT(MONTH FROM de.period)::int AS month,
           SUM(de.amount) AS depreciation
    FROM public.fixed_asset_depreciation_entries de
    JOIN public.fixed_assets fa ON fa.id=de.fixed_asset_id
    WHERE fa.depreciation_start_date IS NULL
       OR de.period>=date_trunc('month',fa.depreciation_start_date::timestamp)::date
    GROUP BY fa.owner_user_id,date_trunc('month',de.period::timestamp)::date,
             EXTRACT(YEAR FROM de.period)::int,EXTRACT(MONTH FROM de.period)::int
),
events AS (
    SELECT owner_user_id,month_start,year,month,income,
           manual_deductible AS deductible_expenses,manual_non_deductible AS non_deductible_expenses,
           0::numeric AS depreciation,owner_contributions,owner_withdrawals
    FROM tx_fiscal
    UNION ALL
    SELECT owner_user_id,month_start,year,month,0::numeric,deductible_expense,non_deductible_expense,
           0::numeric,0::numeric,0::numeric
    FROM allocation_classified
    UNION ALL
    SELECT owner_user_id,month_start,year,month,0::numeric,0::numeric,0::numeric,depreciation,0::numeric,0::numeric
    FROM depreciation
)
SELECT owner_user_id,month_start,year,month,
       ROUND(SUM(income),2) AS income,
       ROUND(SUM(deductible_expenses)+SUM(depreciation),2) AS deductible_expenses,
       ROUND(SUM(depreciation),2) AS depreciation,
       ROUND(SUM(non_deductible_expenses),2) AS non_deductible_expenses,
       ROUND(SUM(owner_contributions),2) AS owner_contributions,
       ROUND(SUM(owner_withdrawals),2) AS owner_withdrawals
FROM events
GROUP BY owner_user_id,month_start,year,month;

CREATE OR REPLACE FUNCTION public.confirm_received_invoice(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid:=auth.uid();
    v_invoice record;
    v_subtotal numeric; v_vat numeric; v_total numeric;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Utilizator neautentificat'; END IF;
    SELECT * INTO v_invoice FROM public.received_invoices
    WHERE id=p_invoice_id AND owner_user_id=v_user_id AND document_status IN ('DRAFT','RECEIVED')
    FOR UPDATE;
    IF v_invoice IS NULL THEN RAISE EXCEPTION 'Factura primită nu există sau nu poate fi confirmată'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.received_invoice_lines WHERE received_invoice_id=p_invoice_id) THEN
        RAISE EXCEPTION 'Factura primită nu are linii';
    END IF;
    SELECT ROUND(COALESCE(SUM(quantity*unit_price),0),2),ROUND(COALESCE(SUM(vat_amount),0),2),ROUND(COALESCE(SUM(total_amount),0),2)
    INTO v_subtotal,v_vat,v_total
    FROM public.received_invoice_lines WHERE received_invoice_id=p_invoice_id;
    IF v_invoice.subtotal IS DISTINCT FROM v_subtotal OR v_invoice.vat_total IS DISTINCT FROM v_vat OR v_invoice.total IS DISTINCT FROM v_total THEN
        RAISE EXCEPTION 'Totalurile facturii primite nu corespund liniilor';
    END IF;
    IF v_total<=0 THEN RAISE EXCEPTION 'Totalul facturii primite trebuie să fie pozitiv'; END IF;
    UPDATE public.received_invoices SET document_status='CONFIRMED',updated_at=now() WHERE id=p_invoice_id;
    RETURN jsonb_build_object('success',true,'invoice_id',p_invoice_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_proforma(p_proforma_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid:=auth.uid();
    v_proforma record;
    v_series_row public.proforma_series%ROWTYPE;
    v_year int; v_series text; v_number int;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Utilizator neautentificat'; END IF;
    SELECT * INTO v_proforma FROM public.proformas
    WHERE id=p_proforma_id AND owner_user_id=v_user_id AND document_status='DRAFT'
    FOR UPDATE;
    IF v_proforma IS NULL THEN RAISE EXCEPTION 'Proforma nu există sau nu poate fi emisă'; END IF;
    IF v_proforma.client_id IS NULL THEN RAISE EXCEPTION 'Client lipsă'; END IF;
    IF v_proforma.issue_date IS NULL THEN RAISE EXCEPTION 'Data emiterii lipsește'; END IF;
    IF v_proforma.due_date IS NULL OR v_proforma.due_date<v_proforma.issue_date THEN RAISE EXCEPTION 'Data scadenței invalidă'; END IF;
    IF v_proforma.total<=0 THEN RAISE EXCEPTION 'Total proformă invalid'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.proforma_lines WHERE proforma_id=p_proforma_id) THEN RAISE EXCEPTION 'Proforma nu are linii'; END IF;
    v_year:=EXTRACT(YEAR FROM v_proforma.issue_date)::int;
    SELECT * INTO v_series_row FROM public.proforma_series
    WHERE owner_user_id=v_user_id AND year=v_year AND active=true
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF v_series_row IS NULL THEN RAISE EXCEPTION 'Nu există o serie activă de proforme pentru anul %',v_year; END IF;
    v_series:=v_series_row.series; v_number:=v_series_row.next_number;
    UPDATE public.proformas SET document_status='ISSUED',series=v_series,number=v_number,updated_at=now()
    WHERE id=p_proforma_id;
    UPDATE public.proforma_series SET next_number=next_number+1,updated_at=now() WHERE id=v_series_row.id;
    RETURN jsonb_build_object('success',true,'proforma_id',p_proforma_id,'series',v_series,'number',v_number,'year',v_year);
END;
$$;

CREATE OR REPLACE VIEW public.daily_cashflow_summary
WITH (security_invoker = true)
AS
SELECT owner_user_id,transaction_date,
       SUM(amount) FILTER (WHERE direction='IN') AS total_in,
       SUM(amount) FILTER (WHERE direction='OUT') AS total_out
FROM public.financial_transactions
WHERE status='CONFIRMED' AND owner_user_id=(SELECT auth.uid())
GROUP BY owner_user_id,transaction_date;

CREATE OR REPLACE VIEW public.overdue_received_invoices_view
WITH (security_invoker = true)
AS
SELECT ri.id AS received_invoice_id,ri.owner_user_id,ri.series,ri.number,ri.document_date,ri.due_date,
       ri.supplier_id,ri.currency,ri.total,ri.paid_total,ri.balance_due,ri.payment_status,ri.document_status,
       CURRENT_DATE-ri.due_date AS days_overdue,s.legal_name AS supplier_name,s.cui AS supplier_cui
FROM public.received_invoices ri
JOIN public.suppliers s ON s.id=ri.supplier_id
WHERE ri.document_status IN ('RECEIVED','CONFIRMED')
  AND ri.invoice_type='NORMAL'
  AND ri.payment_status IN ('UNPAID','PARTIALLY_PAID')
  AND ri.balance_due>0
  AND ri.due_date IS NOT NULL
  AND ri.due_date<CURRENT_DATE
ORDER BY ri.due_date;
