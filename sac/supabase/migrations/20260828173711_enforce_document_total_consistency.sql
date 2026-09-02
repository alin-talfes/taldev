CREATE OR REPLACE FUNCTION public.issue_invoice(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
    v_user_id uuid;
    v_invoice record;
    v_series_id uuid; v_series text; v_year integer; v_number bigint;
    v_gross numeric; v_discount numeric; v_taxable numeric; v_vat numeric; v_total numeric; v_line_count integer;
    v_vat_status text;
BEGIN
    v_user_id:=public.get_auth_user_id();
    SELECT * INTO v_invoice FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
    IF v_invoice IS NULL THEN RAISE EXCEPTION 'Factura nu există'; END IF;
    IF v_invoice.owner_user_id<>v_user_id THEN RAISE EXCEPTION 'Access denied'; END IF;
    IF v_invoice.document_status<>'DRAFT' THEN RAISE EXCEPTION 'Factura a fost deja emisă'; END IF;
    IF v_invoice.client_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.clients WHERE id=v_invoice.client_id AND owner_user_id=v_user_id) THEN RAISE EXCEPTION 'Client lipsă sau invalid'; END IF;
    IF v_invoice.issue_date IS NULL THEN RAISE EXCEPTION 'Data emiterii lipsește'; END IF;
    IF v_invoice.due_date IS NULL OR v_invoice.due_date<v_invoice.issue_date THEN RAISE EXCEPTION 'Data scadenței invalidă'; END IF;

    SELECT COUNT(*),ROUND(COALESCE(SUM(ROUND(quantity*unit_price,2)),0),2),ROUND(COALESCE(SUM(discount),0),2),
           ROUND(COALESCE(SUM(net_amount),0),2),ROUND(COALESCE(SUM(vat_amount),0),2),ROUND(COALESCE(SUM(total_amount),0),2)
    INTO v_line_count,v_gross,v_discount,v_taxable,v_vat,v_total
    FROM public.invoice_lines WHERE invoice_id=p_invoice_id;
    IF v_line_count=0 THEN RAISE EXCEPTION 'Factura nu are linii'; END IF;
    IF v_invoice.subtotal IS DISTINCT FROM v_gross OR v_invoice.discount_total IS DISTINCT FROM v_discount
       OR v_invoice.taxable_base IS DISTINCT FROM v_taxable OR v_invoice.vat_total IS DISTINCT FROM v_vat
       OR v_invoice.total IS DISTINCT FROM v_total THEN
      RAISE EXCEPTION 'Totalurile facturii nu corespund liniilor';
    END IF;
    IF v_total=0 OR (v_total<0 AND v_invoice.invoice_type NOT IN ('STORNO','CORRECTION')) THEN RAISE EXCEPTION 'Total invalid'; END IF;

    SELECT vat_status INTO v_vat_status FROM public.pfa_settings WHERE owner_user_id=v_user_id;
    IF COALESCE(v_vat_status,'neinregistrat')='neinregistrat' AND v_vat<>0 THEN
      RAISE EXCEPTION 'PFA neînregistrat în scopuri de TVA: factura nu poate colecta TVA';
    END IF;

    SELECT id,series,year,next_number INTO v_series_id,v_series,v_year,v_number
    FROM public.invoice_series
    WHERE owner_user_id=v_user_id AND active=true AND year=EXTRACT(YEAR FROM v_invoice.issue_date)::int
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF v_series_id IS NULL THEN RAISE EXCEPTION 'Nu există serie de facturare activă pentru anul %',EXTRACT(YEAR FROM v_invoice.issue_date); END IF;

    UPDATE public.invoices SET series_id=v_series_id,series=v_series,number=v_number,document_status='ISSUED',
      issued_at=now(),updated_at=now() WHERE id=p_invoice_id;
    UPDATE public.invoice_series SET next_number=v_number+1,updated_at=now() WHERE id=v_series_id;
    PERFORM public.write_audit_log('invoice_issued','invoice',p_invoice_id,jsonb_build_object('series',v_series,'number',v_number));
    RETURN jsonb_build_object('success',true,'invoice_id',p_invoice_id,'series',v_series,'number',v_number);
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_proforma(p_proforma_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
    v_user_id uuid:=auth.uid(); v_proforma record; v_series_row public.proforma_series%ROWTYPE;
    v_year int; v_series text; v_number int; v_vat_status text;
    v_gross numeric; v_discount numeric; v_taxable numeric; v_vat numeric; v_total numeric; v_line_count integer;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Utilizator neautentificat'; END IF;
    SELECT * INTO v_proforma FROM public.proformas
    WHERE id=p_proforma_id AND owner_user_id=v_user_id AND document_status='DRAFT' FOR UPDATE;
    IF v_proforma IS NULL THEN RAISE EXCEPTION 'Proforma nu există sau nu poate fi emisă'; END IF;
    IF v_proforma.client_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.clients WHERE id=v_proforma.client_id AND owner_user_id=v_user_id) THEN RAISE EXCEPTION 'Client lipsă sau invalid'; END IF;
    IF v_proforma.issue_date IS NULL THEN RAISE EXCEPTION 'Data emiterii lipsește'; END IF;
    IF v_proforma.due_date IS NULL OR v_proforma.due_date<v_proforma.issue_date THEN RAISE EXCEPTION 'Data scadenței invalidă'; END IF;

    SELECT COUNT(*),ROUND(COALESCE(SUM(ROUND(quantity*unit_price,2)),0),2),ROUND(COALESCE(SUM(discount),0),2),
           ROUND(COALESCE(SUM(net_amount),0),2),ROUND(COALESCE(SUM(vat_amount),0),2),ROUND(COALESCE(SUM(total_amount),0),2)
    INTO v_line_count,v_gross,v_discount,v_taxable,v_vat,v_total
    FROM public.proforma_lines WHERE proforma_id=p_proforma_id;
    IF v_line_count=0 THEN RAISE EXCEPTION 'Proforma nu are linii'; END IF;
    IF v_proforma.subtotal IS DISTINCT FROM v_gross OR v_proforma.discount_total IS DISTINCT FROM v_discount
       OR v_proforma.taxable_base IS DISTINCT FROM v_taxable OR v_proforma.vat_total IS DISTINCT FROM v_vat
       OR v_proforma.total IS DISTINCT FROM v_total THEN RAISE EXCEPTION 'Totalurile proformei nu corespund liniilor'; END IF;
    IF v_total<=0 THEN RAISE EXCEPTION 'Total proformă invalid'; END IF;

    SELECT vat_status INTO v_vat_status FROM public.pfa_settings WHERE owner_user_id=v_user_id;
    IF COALESCE(v_vat_status,'neinregistrat')='neinregistrat' AND v_vat<>0 THEN
      RAISE EXCEPTION 'PFA neînregistrat în scopuri de TVA: proforma nu poate afișa TVA colectată';
    END IF;

    v_year:=EXTRACT(YEAR FROM v_proforma.issue_date)::int;
    SELECT * INTO v_series_row FROM public.proforma_series
    WHERE owner_user_id=v_user_id AND year=v_year AND active=true ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF v_series_row IS NULL THEN RAISE EXCEPTION 'Nu există o serie activă de proforme pentru anul %',v_year; END IF;
    v_series:=v_series_row.series; v_number:=v_series_row.next_number;
    UPDATE public.proformas SET document_status='ISSUED',series=v_series,number=v_number,updated_at=now() WHERE id=p_proforma_id;
    UPDATE public.proforma_series SET next_number=next_number+1,updated_at=now() WHERE id=v_series_row.id;
    RETURN jsonb_build_object('success',true,'proforma_id',p_proforma_id,'series',v_series,'number',v_number,'year',v_year);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_received_invoice(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE v_user_id uuid:=auth.uid(); v_invoice record; v_subtotal numeric; v_vat numeric; v_total numeric; v_count integer;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Utilizator neautentificat'; END IF;
    SELECT * INTO v_invoice FROM public.received_invoices
    WHERE id=p_invoice_id AND owner_user_id=v_user_id AND document_status IN ('DRAFT','RECEIVED') AND invoice_type='NORMAL' FOR UPDATE;
    IF v_invoice IS NULL THEN RAISE EXCEPTION 'Factura primită nu există sau nu poate fi confirmată'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id=v_invoice.supplier_id AND owner_user_id=v_user_id) THEN RAISE EXCEPTION 'Furnizor invalid'; END IF;
    SELECT COUNT(*),ROUND(COALESCE(SUM(ROUND(quantity*unit_price,2)),0),2),ROUND(COALESCE(SUM(vat_amount),0),2),ROUND(COALESCE(SUM(total_amount),0),2)
    INTO v_count,v_subtotal,v_vat,v_total FROM public.received_invoice_lines WHERE received_invoice_id=p_invoice_id;
    IF v_count=0 THEN RAISE EXCEPTION 'Factura primită nu are linii'; END IF;
    IF v_invoice.subtotal IS DISTINCT FROM v_subtotal OR v_invoice.vat_total IS DISTINCT FROM v_vat OR v_invoice.total IS DISTINCT FROM v_total THEN
      RAISE EXCEPTION 'Totalurile facturii primite nu corespund liniilor';
    END IF;
    IF v_total<=0 THEN RAISE EXCEPTION 'Totalul facturii primite trebuie să fie pozitiv'; END IF;
    UPDATE public.received_invoices SET document_status='CONFIRMED',updated_at=now() WHERE id=p_invoice_id;
    RETURN jsonb_build_object('success',true,'invoice_id',p_invoice_id);
END;
$$;
