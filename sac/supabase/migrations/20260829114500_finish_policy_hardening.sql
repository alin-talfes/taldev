-- Finish RLS init-plan hardening and keep the internal recalculation helper private.

alter policy proforma_series_select_own
  on public.proforma_series
  to authenticated
  using (owner_user_id = (select auth.uid()));

alter policy proforma_series_insert_own
  on public.proforma_series
  to authenticated
  with check (owner_user_id = (select auth.uid()));

alter policy proforma_series_update_own
  on public.proforma_series
  to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

alter policy proforma_series_delete_own
  on public.proforma_series
  to authenticated
  using (owner_user_id = (select auth.uid()));

alter policy financial_tx_delete_own_pending_only
  on public.financial_transactions
  to authenticated
  using (
    owner_user_id = (select auth.uid())
    and status = 'PENDING'
  );

revoke all on function public.recalculate_invoice_totals(uuid) from public, anon, authenticated;
grant execute on function public.recalculate_invoice_totals(uuid) to service_role;
