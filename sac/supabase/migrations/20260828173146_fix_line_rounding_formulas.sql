-- Canonical monetary rounding: line net and VAT are rounded to 2 decimals,
-- and line total is their exact sum.
ALTER TABLE public.invoice_lines
  DROP CONSTRAINT IF EXISTS invoice_lines_net_amount_calc,
  DROP CONSTRAINT IF EXISTS invoice_lines_vat_amount_calc,
  DROP CONSTRAINT IF EXISTS invoice_lines_total_amount_calc,
  DROP CONSTRAINT IF EXISTS invoice_lines_vat_rate_range;
ALTER TABLE public.invoice_lines
  ADD CONSTRAINT invoice_lines_net_amount_calc CHECK (net_amount = ROUND(quantity*unit_price-discount,2)),
  ADD CONSTRAINT invoice_lines_vat_amount_calc CHECK (vat_amount = ROUND(net_amount*vat_rate/100.0,2)),
  ADD CONSTRAINT invoice_lines_total_amount_calc CHECK (total_amount = ROUND(net_amount+vat_amount,2)),
  ADD CONSTRAINT invoice_lines_vat_rate_range CHECK (vat_rate >= 0 AND vat_rate <= 100);

ALTER TABLE public.proforma_lines
  DROP CONSTRAINT IF EXISTS proforma_lines_net_amount_calc,
  DROP CONSTRAINT IF EXISTS proforma_lines_vat_amount_calc,
  DROP CONSTRAINT IF EXISTS proforma_lines_total_amount_calc,
  DROP CONSTRAINT IF EXISTS proforma_lines_vat_rate_check;
ALTER TABLE public.proforma_lines
  ADD CONSTRAINT proforma_lines_net_amount_calc CHECK (net_amount = ROUND(quantity*unit_price-discount,2)),
  ADD CONSTRAINT proforma_lines_vat_amount_calc CHECK (vat_amount = ROUND(net_amount*vat_rate/100.0,2)),
  ADD CONSTRAINT proforma_lines_total_amount_calc CHECK (total_amount = ROUND(net_amount+vat_amount,2)),
  ADD CONSTRAINT proforma_lines_vat_rate_check CHECK (vat_rate >= 0 AND vat_rate <= 100);

ALTER TABLE public.received_invoice_lines
  DROP CONSTRAINT IF EXISTS received_lines_net_amount_calc,
  DROP CONSTRAINT IF EXISTS received_lines_vat_amount_calc,
  DROP CONSTRAINT IF EXISTS received_lines_total_amount_calc,
  DROP CONSTRAINT IF EXISTS received_invoice_lines_vat_rate_check;
ALTER TABLE public.received_invoice_lines
  ADD CONSTRAINT received_lines_net_amount_calc CHECK (net_amount = ROUND(quantity*unit_price-discount,2)),
  ADD CONSTRAINT received_lines_vat_amount_calc CHECK (vat_amount = ROUND(net_amount*vat_rate/100.0,2)),
  ADD CONSTRAINT received_lines_total_amount_calc CHECK (total_amount = ROUND(net_amount+vat_amount,2)),
  ADD CONSTRAINT received_invoice_lines_vat_rate_check CHECK (vat_rate >= 0 AND vat_rate <= 100);

CREATE OR REPLACE FUNCTION public.save_invoice_draft(
    p_invoice_id uuid,
    p_client_id uuid,
    p_issue_date date,
    p_due_date date,
    p_currency text,
    p_payment_terms integer,
    p_notes text,
    p_lines jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_invoice_id uuid;
    v_subtotal numeric := 0;
    v_discount_total numeric := 0;
    v_taxable_base numeric := 0;
    v_vat_total numeric := 0;
    v_total numeric := 0;
    v_line jsonb;
    v_quantity numeric;
    v_unit_price numeric;
    v_discount numeric;
    v_vat_rate numeric;
    v_gross numeric;
    v_net numeric;
    v_vat numeric;
    v_line_total numeric;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Utilizator neautentificat'; END IF;
    IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Parametrul p_lines trebuie să fie un array JSON'; END IF;
    IF p_due_date IS NOT NULL AND p_issue_date IS NOT NULL AND p_due_date < p_issue_date THEN RAISE EXCEPTION 'Data scadenței nu poate fi anterioară emiterii'; END IF;
    IF p_client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clients WHERE id=p_client_id AND owner_user_id=v_user_id) THEN
        RAISE EXCEPTION 'Client invalid sau acces interzis';
    END IF;

    IF p_invoice_id IS NOT NULL THEN
        SELECT id INTO v_invoice_id
        FROM public.invoices
        WHERE id=p_invoice_id AND owner_user_id=v_user_id AND document_status='DRAFT' AND invoice_type='INVOICE';
        IF v_invoice_id IS NULL THEN RAISE EXCEPTION 'Factura nu există sau nu este un draft de factură normală'; END IF;
    END IF;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_quantity := COALESCE((v_line->>'quantity')::numeric,0);
        v_unit_price := COALESCE((v_line->>'unit_price')::numeric,0);
        v_discount := COALESCE((v_line->>'discount')::numeric,0);
        v_vat_rate := COALESCE((v_line->>'vat_rate')::numeric,0);
        IF v_quantity <= 0 THEN RAISE EXCEPTION 'Cantitatea trebuie să fie pozitivă'; END IF;
        IF v_unit_price < 0 THEN RAISE EXCEPTION 'Prețul unitar nu poate fi negativ'; END IF;
        IF v_vat_rate < 0 OR v_vat_rate > 100 THEN RAISE EXCEPTION 'Cota TVA trebuie să fie între 0 și 100'; END IF;
        v_gross := ROUND(v_quantity*v_unit_price,2);
        IF v_discount < 0 OR v_discount > v_gross THEN RAISE EXCEPTION 'Discount invalid'; END IF;
        v_net := ROUND(v_gross-v_discount,2);
        v_vat := ROUND(v_net*v_vat_rate/100.0,2);
        v_line_total := ROUND(v_net+v_vat,2);
        v_subtotal := v_subtotal+v_gross;
        v_discount_total := v_discount_total+ROUND(v_discount,2);
        v_taxable_base := v_taxable_base+v_net;
        v_vat_total := v_vat_total+v_vat;
        v_total := v_total+v_line_total;
    END LOOP;

    IF v_invoice_id IS NULL THEN
        INSERT INTO public.invoices(
            owner_user_id,client_id,issue_date,due_date,currency,payment_terms,notes,
            document_status,payment_status,subtotal,discount_total,taxable_base,vat_total,total,
            paid_total,balance_due,invoice_type
        ) VALUES (
            v_user_id,p_client_id,p_issue_date,p_due_date,p_currency,p_payment_terms,p_notes,
            'DRAFT','UNPAID',ROUND(v_subtotal,2),ROUND(v_discount_total,2),ROUND(v_taxable_base,2),
            ROUND(v_vat_total,2),ROUND(v_total,2),0,ROUND(v_total,2),'INVOICE'
        ) RETURNING id INTO v_invoice_id;
    ELSE
        UPDATE public.invoices
        SET client_id=p_client_id,issue_date=p_issue_date,due_date=p_due_date,currency=p_currency,
            payment_terms=p_payment_terms,notes=p_notes,subtotal=ROUND(v_subtotal,2),
            discount_total=ROUND(v_discount_total,2),taxable_base=ROUND(v_taxable_base,2),
            vat_total=ROUND(v_vat_total,2),total=ROUND(v_total,2),
            balance_due=ROUND(v_total-paid_total,2),updated_at=now()
        WHERE id=v_invoice_id;
    END IF;

    DELETE FROM public.invoice_lines WHERE invoice_id=v_invoice_id;
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_quantity := COALESCE((v_line->>'quantity')::numeric,0);
        v_unit_price := COALESCE((v_line->>'unit_price')::numeric,0);
        v_discount := COALESCE((v_line->>'discount')::numeric,0);
        v_vat_rate := COALESCE((v_line->>'vat_rate')::numeric,0);
        v_gross := ROUND(v_quantity*v_unit_price,2);
        v_net := ROUND(v_gross-v_discount,2);
        v_vat := ROUND(v_net*v_vat_rate/100.0,2);
        v_line_total := ROUND(v_net+v_vat,2);
        INSERT INTO public.invoice_lines(
            invoice_id,position,description,quantity,unit,unit_price,discount,vat_rate,vat_category,
            net_amount,vat_amount,total_amount
        ) VALUES (
            v_invoice_id,COALESCE((v_line->>'position')::int,1),v_line->>'description',v_quantity,
            v_line->>'unit',v_unit_price,ROUND(v_discount,2),v_vat_rate,COALESCE(v_line->>'vat_category','NONE'),
            v_net,v_vat,v_line_total
        );
    END LOOP;
    RETURN v_invoice_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_proforma_draft(
    p_proforma_id uuid,p_client_id uuid,p_series text,p_number integer,p_issue_date date,p_due_date date,
    p_currency text,p_payment_terms integer,p_notes text,p_lines jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_proforma_id uuid;
    v_subtotal numeric := 0; v_discount_total numeric := 0; v_taxable_base numeric := 0;
    v_vat_total numeric := 0; v_total numeric := 0;
    v_line jsonb; v_q numeric; v_price numeric; v_discount numeric; v_rate numeric;
    v_gross numeric; v_net numeric; v_vat numeric; v_line_total numeric;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Utilizator neautentificat'; END IF;
    IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Parametrul p_lines trebuie să fie un array JSON'; END IF;
    IF p_due_date IS NOT NULL AND p_issue_date IS NOT NULL AND p_due_date<p_issue_date THEN RAISE EXCEPTION 'Data scadenței nu poate fi anterioară emiterii'; END IF;
    IF p_client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clients WHERE id=p_client_id AND owner_user_id=v_user_id) THEN RAISE EXCEPTION 'Client invalid sau acces interzis'; END IF;
    IF p_proforma_id IS NOT NULL THEN
        SELECT id INTO v_proforma_id FROM public.proformas
        WHERE id=p_proforma_id AND owner_user_id=v_user_id AND document_status='DRAFT';
        IF v_proforma_id IS NULL THEN RAISE EXCEPTION 'Proforma nu există sau nu este draft'; END IF;
    END IF;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
        v_q:=COALESCE((v_line->>'quantity')::numeric,0); v_price:=COALESCE((v_line->>'unit_price')::numeric,0);
        v_discount:=COALESCE((v_line->>'discount')::numeric,0); v_rate:=COALESCE((v_line->>'vat_rate')::numeric,0);
        IF v_q<=0 OR v_price<0 OR v_rate<0 OR v_rate>100 THEN RAISE EXCEPTION 'Linie proformă invalidă'; END IF;
        v_gross:=ROUND(v_q*v_price,2);
        IF v_discount<0 OR v_discount>v_gross THEN RAISE EXCEPTION 'Discount invalid'; END IF;
        v_net:=ROUND(v_gross-v_discount,2); v_vat:=ROUND(v_net*v_rate/100.0,2); v_line_total:=ROUND(v_net+v_vat,2);
        v_subtotal:=v_subtotal+v_gross; v_discount_total:=v_discount_total+ROUND(v_discount,2);
        v_taxable_base:=v_taxable_base+v_net; v_vat_total:=v_vat_total+v_vat; v_total:=v_total+v_line_total;
    END LOOP;

    IF v_proforma_id IS NULL THEN
        INSERT INTO public.proformas(owner_user_id,client_id,series,number,issue_date,due_date,currency,payment_terms,notes,
            document_status,subtotal,discount_total,taxable_base,vat_total,total)
        VALUES(v_user_id,p_client_id,p_series,p_number,p_issue_date,p_due_date,p_currency,p_payment_terms,p_notes,'DRAFT',
            ROUND(v_subtotal,2),ROUND(v_discount_total,2),ROUND(v_taxable_base,2),ROUND(v_vat_total,2),ROUND(v_total,2))
        RETURNING id INTO v_proforma_id;
    ELSE
        UPDATE public.proformas SET client_id=p_client_id,series=p_series,number=p_number,issue_date=p_issue_date,due_date=p_due_date,
            currency=p_currency,payment_terms=p_payment_terms,notes=p_notes,subtotal=ROUND(v_subtotal,2),
            discount_total=ROUND(v_discount_total,2),taxable_base=ROUND(v_taxable_base,2),vat_total=ROUND(v_vat_total,2),
            total=ROUND(v_total,2),updated_at=now() WHERE id=v_proforma_id;
    END IF;

    DELETE FROM public.proforma_lines WHERE proforma_id=v_proforma_id;
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
        v_q:=COALESCE((v_line->>'quantity')::numeric,0); v_price:=COALESCE((v_line->>'unit_price')::numeric,0);
        v_discount:=COALESCE((v_line->>'discount')::numeric,0); v_rate:=COALESCE((v_line->>'vat_rate')::numeric,0);
        v_gross:=ROUND(v_q*v_price,2); v_net:=ROUND(v_gross-v_discount,2); v_vat:=ROUND(v_net*v_rate/100.0,2); v_line_total:=ROUND(v_net+v_vat,2);
        INSERT INTO public.proforma_lines(proforma_id,position,description,quantity,unit,unit_price,discount,vat_rate,vat_category,net_amount,vat_amount,total_amount)
        VALUES(v_proforma_id,COALESCE((v_line->>'position')::int,1),v_line->>'description',v_q,v_line->>'unit',v_price,
            ROUND(v_discount,2),v_rate,COALESCE(v_line->>'vat_category','NONE'),v_net,v_vat,v_line_total);
    END LOOP;
    RETURN v_proforma_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_received_invoice_draft(
    p_invoice_id uuid,p_supplier_id uuid,p_series text,p_number text,p_document_date date,p_due_date date,
    p_currency text,p_category text,p_deductible_status text,p_notes text,p_lines jsonb,
    p_deductibility_percent numeric DEFAULT NULL,p_deductibility_limit numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid := auth.uid(); v_invoice_id uuid;
    v_subtotal numeric:=0; v_vat_total numeric:=0; v_total numeric:=0;
    v_line jsonb; v_q numeric; v_price numeric; v_discount numeric; v_rate numeric;
    v_gross numeric; v_net numeric; v_vat numeric; v_line_total numeric;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Utilizator neautentificat'; END IF;
    IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Parametrul p_lines trebuie să fie un array JSON'; END IF;
    IF p_due_date IS NOT NULL AND p_due_date<p_document_date THEN RAISE EXCEPTION 'Data scadenței nu poate fi anterioară documentului'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id=p_supplier_id AND owner_user_id=v_user_id) THEN RAISE EXCEPTION 'Furnizor invalid sau acces interzis'; END IF;
    IF p_deductibility_percent IS NOT NULL AND (p_deductibility_percent<0 OR p_deductibility_percent>100) THEN RAISE EXCEPTION 'Procent deductibilitate invalid'; END IF;
    IF p_deductibility_limit IS NOT NULL AND p_deductibility_limit<0 THEN RAISE EXCEPTION 'Plafon deductibilitate invalid'; END IF;
    IF p_deductible_status='PARTIALLY_DEDUCTIBLE' AND p_deductibility_percent IS NULL AND p_deductibility_limit IS NULL THEN RAISE EXCEPTION 'Deductibilitatea parțială necesită procent sau plafon'; END IF;
    IF p_invoice_id IS NOT NULL THEN
        SELECT id INTO v_invoice_id FROM public.received_invoices
        WHERE id=p_invoice_id AND owner_user_id=v_user_id AND document_status='DRAFT' AND invoice_type='NORMAL';
        IF v_invoice_id IS NULL THEN RAISE EXCEPTION 'Factura primită nu există sau nu este draft normal'; END IF;
    END IF;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
        v_q:=COALESCE((v_line->>'quantity')::numeric,0); v_price:=COALESCE((v_line->>'unit_price')::numeric,0);
        v_discount:=COALESCE((v_line->>'discount')::numeric,0); v_rate:=COALESCE((v_line->>'vat_rate')::numeric,0);
        IF v_q<=0 OR v_price<0 OR v_rate<0 OR v_rate>100 THEN RAISE EXCEPTION 'Linie factură primită invalidă'; END IF;
        v_gross:=ROUND(v_q*v_price,2);
        IF v_discount<0 OR v_discount>v_gross THEN RAISE EXCEPTION 'Discount invalid'; END IF;
        v_net:=ROUND(v_gross-v_discount,2); v_vat:=ROUND(v_net*v_rate/100.0,2); v_line_total:=ROUND(v_net+v_vat,2);
        v_subtotal:=v_subtotal+v_gross; v_vat_total:=v_vat_total+v_vat; v_total:=v_total+v_line_total;
    END LOOP;

    IF v_invoice_id IS NULL THEN
        INSERT INTO public.received_invoices(owner_user_id,supplier_id,series,number,document_date,due_date,currency,category,
            deductible_status,notes,document_status,payment_status,subtotal,vat_total,total,paid_total,balance_due,invoice_type,
            deductibility_percent,deductibility_limit)
        VALUES(v_user_id,p_supplier_id,p_series,p_number,p_document_date,p_due_date,p_currency,p_category,p_deductible_status,p_notes,
            'DRAFT','UNPAID',ROUND(v_subtotal,2),ROUND(v_vat_total,2),ROUND(v_total,2),0,ROUND(v_total,2),'NORMAL',
            p_deductibility_percent,p_deductibility_limit)
        RETURNING id INTO v_invoice_id;
    ELSE
        UPDATE public.received_invoices SET supplier_id=p_supplier_id,series=p_series,number=p_number,document_date=p_document_date,
            due_date=p_due_date,currency=p_currency,category=p_category,deductible_status=p_deductible_status,notes=p_notes,
            subtotal=ROUND(v_subtotal,2),vat_total=ROUND(v_vat_total,2),total=ROUND(v_total,2),
            balance_due=ROUND(v_total-paid_total,2),deductibility_percent=p_deductibility_percent,
            deductibility_limit=p_deductibility_limit,updated_at=now() WHERE id=v_invoice_id;
    END IF;

    DELETE FROM public.received_invoice_lines WHERE received_invoice_id=v_invoice_id;
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
        v_q:=COALESCE((v_line->>'quantity')::numeric,0); v_price:=COALESCE((v_line->>'unit_price')::numeric,0);
        v_discount:=COALESCE((v_line->>'discount')::numeric,0); v_rate:=COALESCE((v_line->>'vat_rate')::numeric,0);
        v_gross:=ROUND(v_q*v_price,2); v_net:=ROUND(v_gross-v_discount,2); v_vat:=ROUND(v_net*v_rate/100.0,2); v_line_total:=ROUND(v_net+v_vat,2);
        INSERT INTO public.received_invoice_lines(received_invoice_id,position,description,quantity,unit,unit_price,discount,vat_rate,
            vat_category,net_amount,vat_amount,total_amount,treatment)
        VALUES(v_invoice_id,COALESCE((v_line->>'position')::int,1),v_line->>'description',v_q,v_line->>'unit',v_price,
            ROUND(v_discount,2),v_rate,COALESCE(v_line->>'vat_category','NONE'),v_net,v_vat,v_line_total,
            COALESCE(v_line->>'treatment','cheltuiala_curenta'));
    END LOOP;
    RETURN v_invoice_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_invoice_totals(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid; v_gross numeric:=0; v_discount numeric:=0; v_taxable numeric:=0; v_vat numeric:=0; v_total numeric:=0;
BEGIN
    v_user_id:=public.get_auth_user_id();
    PERFORM 1 FROM public.invoices WHERE id=p_invoice_id AND owner_user_id=v_user_id AND document_status='DRAFT';
    IF NOT FOUND THEN RAISE EXCEPTION 'Factura nu există, nu aparține utilizatorului sau nu mai este draft'; END IF;
    SELECT COALESCE(SUM(net_amount+discount),0),COALESCE(SUM(discount),0),COALESCE(SUM(net_amount),0),
           COALESCE(SUM(vat_amount),0),COALESCE(SUM(total_amount),0)
    INTO v_gross,v_discount,v_taxable,v_vat,v_total
    FROM public.invoice_lines WHERE invoice_id=p_invoice_id;
    UPDATE public.invoices SET subtotal=ROUND(v_gross,2),discount_total=ROUND(v_discount,2),taxable_base=ROUND(v_taxable,2),
        vat_total=ROUND(v_vat,2),total=ROUND(v_total,2),balance_due=ROUND(v_total-paid_total,2),updated_at=now()
    WHERE id=p_invoice_id;
    RETURN jsonb_build_object('success',true,'subtotal',ROUND(v_gross,2),'discount',ROUND(v_discount,2),
        'taxable_base',ROUND(v_taxable,2),'vat',ROUND(v_vat,2),'total',ROUND(v_total,2));
END;
$$;
