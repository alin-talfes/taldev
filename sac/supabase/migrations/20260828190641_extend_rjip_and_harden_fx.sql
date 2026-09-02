CREATE OR REPLACE VIEW public.rjip_view
WITH (security_invoker=true)
AS
SELECT ft.id AS transaction_id,ft.owner_user_id,ft.transaction_date,ft.direction,ft.transaction_type,ft.description,
       ft.counterparty_name,ft.reference,ft.payment_method,COALESCE(ft.amount_ron,ft.amount)::numeric(15,2) AS amount,'RON'::text AS currency,ft.status,
       ba.bank_name,ba.iban,
       COALESCE((SELECT string_agg(DISTINCT c.legal_name,', ') FROM public.transaction_allocations ta
                 JOIN public.invoices inv ON inv.id=ta.invoice_id JOIN public.clients c ON c.id=inv.client_id WHERE ta.transaction_id=ft.id),
                (SELECT string_agg(DISTINCT s.legal_name,', ') FROM public.transaction_allocations ta
                 JOIN public.received_invoices ri ON ri.id=ta.received_invoice_id JOIN public.suppliers s ON s.id=ri.supplier_id WHERE ta.transaction_id=ft.id)) AS counterparty_name_resolved,
       (SELECT string_agg(DISTINCT inv.series,', ') FROM public.transaction_allocations ta JOIN public.invoices inv ON inv.id=ta.invoice_id WHERE ta.transaction_id=ft.id) AS invoice_series,
       (SELECT string_agg(DISTINCT inv.number::text,', ') FROM public.transaction_allocations ta JOIN public.invoices inv ON inv.id=ta.invoice_id WHERE ta.transaction_id=ft.id) AS invoice_number,
       (SELECT string_agg(DISTINCT ri.series,', ') FROM public.transaction_allocations ta JOIN public.received_invoices ri ON ri.id=ta.received_invoice_id WHERE ta.transaction_id=ft.id) AS received_invoice_series,
       (SELECT string_agg(DISTINCT ri.number,', ') FROM public.transaction_allocations ta JOIN public.received_invoices ri ON ri.id=ta.received_invoice_id WHERE ta.transaction_id=ft.id) AS received_invoice_number,
       ft.amount AS original_amount,ft.currency AS original_currency,ft.exchange_rate,ft.exchange_rate_date,
       ft.bank_amount_ron,ft.fx_cash_difference_ron,ft.fx_fiscal_treatment,ft.fx_source,
       CASE WHEN ft.currency='RON' THEN NULL ELSE
         format('%s %s × curs BNR %s (%s) = %s RON%s',
           trim(to_char(ft.amount,'FM999999999990.00')),ft.currency,
           trim(to_char(ft.exchange_rate,'FM999999999990.000000')),to_char(ft.exchange_rate_date,'DD.MM.YYYY'),
           trim(to_char(ft.amount_ron,'FM999999999990.00')),
           CASE WHEN ft.bank_amount_ron IS NOT NULL THEN format('; bancă %s RON; diferență %s RON',
             trim(to_char(ft.bank_amount_ron,'FM999999999990.00')),trim(to_char(ft.fx_cash_difference_ron,'FM999999999990.00'))) ELSE '' END)
         END AS fx_explanation
FROM public.financial_transactions ft
LEFT JOIN public.bank_accounts ba ON ba.id=ft.bank_account_id
WHERE ft.status='CONFIRMED';

REVOKE ALL ON FUNCTION public.set_financial_transaction_fx_values() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_transaction_allocation_ron_value() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_received_invoice_exchange_rate(uuid,numeric,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_received_invoice_exchange_rate(uuid,numeric,date,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.register_fx_transaction(text,uuid,numeric,date,numeric,date,numeric,text,uuid,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_fx_transaction(text,uuid,numeric,date,numeric,date,numeric,text,uuid,text,text,text,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirm_received_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_received_invoice(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_fixed_asset_from_invoice_line(uuid,text,text,text,text,date,date,text,integer,date,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_fixed_asset_from_invoice_line(uuid,text,text,text,text,date,date,text,integer,date,text,text,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_fiscal_summary(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fiscal_summary(integer) TO authenticated, service_role;
