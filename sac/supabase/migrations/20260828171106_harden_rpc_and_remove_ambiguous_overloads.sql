-- 1. Elimina overload-urile vechi care fac apelurile RPC ambigue.
-- Versiunile noi raman compatibile deoarece ultimii parametri au DEFAULT.
DROP FUNCTION IF EXISTS public.save_received_invoice_draft(
  uuid, uuid, text, text, date, date, text, text, text, text, jsonb
);

DROP FUNCTION IF EXISTS public.save_other_operation(
  uuid, text, text, numeric, date, text, text, uuid, text, text, text,
  text, text, date, text, text, text
);

-- 2. Fixeaza search_path pentru toate functiile SECURITY DEFINER din public.
-- Corpurile functiilor folosesc relatii schema-qualified; pg_catalog ramane implicit disponibil.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = %L', r.fn, '');
  END LOOP;
END
$$;

-- 3. Inchide executia implicita a functiilor din schema public.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- Functiile RPC intentionat expuse aplicatiei.
GRANT EXECUTE ON FUNCTION public.cancel_other_operation(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_received_invoice(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.convert_proforma_to_invoice(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_fixed_asset_from_invoice_line(uuid,text,text,text,text,date,date,text,integer,date,text,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_received_invoice_storno(uuid,text,text,date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_storno_invoice(uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dispose_fixed_asset(uuid,text,date,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_depreciation_schedule(uuid,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_inventory_item_number(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_inventory_number(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_active_proforma_series_and_next_number(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_active_series_and_next_number(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_fiscal_summary(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_invoice(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_proforma(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recalculate_invoice_totals(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_depreciation_entry(uuid,date,numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_manual_transaction(text,text,numeric,date,text,text,uuid,text,text,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_payment(uuid,numeric,date,text,uuid,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_receipt(uuid,numeric,date,text,uuid,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_invoice_draft(uuid,uuid,date,date,text,integer,text,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_other_operation(uuid,text,text,numeric,date,text,text,uuid,text,text,text,text,text,date,text,text,text,numeric,numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_proforma_draft(uuid,uuid,text,integer,date,date,text,integer,text,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_received_invoice_draft(uuid,uuid,text,text,date,date,text,text,text,text,jsonb,numeric,numeric) TO authenticated, service_role;

-- Functiile interne (helpers, trigger/event-trigger, audit) raman neapelabile direct
-- de rolurile Data API. Proprietarul functiilor le poate folosi in continuare intern.
REVOKE EXECUTE ON FUNCTION public.assert_owner(uuid) FROM authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_auth_user_id() FROM authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.write_audit_log(text,text,uuid,jsonb) FROM authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.check_document_links_owner() FROM authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.check_transaction_allocations_owner() FROM authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated, service_role;

-- 4. Secure-by-default pentru functiile create ulterior de postgres in public.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

