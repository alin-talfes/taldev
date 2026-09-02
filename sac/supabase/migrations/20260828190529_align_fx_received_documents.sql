CREATE OR REPLACE FUNCTION public.confirm_received_invoice(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid:=auth.uid();
  v_invoice record;
  v_subtotal numeric; v_vat numeric; v_total numeric; v_count integer;
  v_has_fixed_asset boolean;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Utilizator neautentificat'; END IF;
  SELECT * INTO v_invoice FROM public.received_invoices
  WHERE id=p_invoice_id AND owner_user_id=v_user_id AND document_status IN ('DRAFT','RECEIVED') AND invoice_type='NORMAL' FOR UPDATE;
  IF v_invoice IS NULL THEN RAISE EXCEPTION 'Factura primită nu există sau nu poate fi confirmată'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id=v_invoice.supplier_id AND owner_user_id=v_user_id) THEN RAISE EXCEPTION 'Furnizor invalid'; END IF;

  SELECT COUNT(*),ROUND(COALESCE(SUM(ROUND(quantity*unit_price,2)),0),2),ROUND(COALESCE(SUM(vat_amount),0),2),ROUND(COALESCE(SUM(total_amount),0),2),
         COALESCE(BOOL_OR(treatment='mijloc_fix'),false)
  INTO v_count,v_subtotal,v_vat,v_total,v_has_fixed_asset
  FROM public.received_invoice_lines WHERE received_invoice_id=p_invoice_id;

  IF v_count=0 THEN RAISE EXCEPTION 'Factura primită nu are linii'; END IF;
  IF v_invoice.subtotal IS DISTINCT FROM v_subtotal OR v_invoice.vat_total IS DISTINCT FROM v_vat OR v_invoice.total IS DISTINCT FROM v_total THEN
    RAISE EXCEPTION 'Totalurile facturii primite nu corespund liniilor';
  END IF;
  IF v_total<=0 THEN RAISE EXCEPTION 'Totalul facturii primite trebuie să fie pozitiv'; END IF;

  IF v_invoice.currency <> 'RON' AND v_has_fixed_asset THEN
    IF v_invoice.document_exchange_rate IS NULL OR v_invoice.document_exchange_rate_date IS NULL THEN
      RAISE EXCEPTION 'Factura în % conține mijloc fix: setați cursul BNR al documentului înainte de confirmare',v_invoice.currency;
    END IF;
    IF v_invoice.document_exchange_rate_date >= v_invoice.document_date THEN
      RAISE EXCEPTION 'Data cursului BNR al documentului trebuie să fie anterioară datei facturii';
    END IF;
  END IF;

  UPDATE public.received_invoices SET document_status='CONFIRMED',updated_at=now() WHERE id=p_invoice_id;
  RETURN jsonb_build_object('success',true,'invoice_id',p_invoice_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_fixed_asset_from_invoice_line(
  p_received_invoice_line_id uuid,
  p_name text,
  p_asset_category text,
  p_classification_code text,
  p_serial_number text DEFAULT NULL,
  p_entry_date date DEFAULT NULL,
  p_commissioning_date date DEFAULT NULL,
  p_depreciation_method text DEFAULT 'LINEAR',
  p_useful_life_months integer DEFAULT NULL,
  p_depreciation_start_date date DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_responsible_person text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid;
  v_line record;
  v_received_invoice record;
  v_fixed_asset_id uuid;
  v_source_value numeric;
  v_acquisition_value numeric;
  v_vat_status text;
  v_exchange_rate numeric := 1;
  v_exchange_rate_date date;
  v_put_into_use_date date;
  v_legal_start_date date;
  v_start_date date;
  v_monthly numeric := 0;
  v_deg_coeff numeric := 1.5;
BEGIN
  v_user_id := public.get_auth_user_id();

  SELECT * INTO v_line FROM public.received_invoice_lines WHERE id=p_received_invoice_line_id FOR UPDATE;
  IF v_line IS NULL THEN RAISE EXCEPTION 'Linie factură nu există'; END IF;

  SELECT * INTO v_received_invoice FROM public.received_invoices WHERE id=v_line.received_invoice_id FOR UPDATE;
  IF v_received_invoice IS NULL OR v_received_invoice.owner_user_id<>v_user_id THEN RAISE EXCEPTION 'Factură primită nu există sau acces interzis'; END IF;
  IF v_line.treatment<>'mijloc_fix' THEN RAISE EXCEPTION 'Linia nu este clasificată ca mijloc fix'; END IF;
  IF EXISTS (SELECT 1 FROM public.fixed_assets WHERE source_invoice_line_id=p_received_invoice_line_id) THEN RAISE EXCEPTION 'Există deja un mijloc fix pentru această linie'; END IF;

  SELECT ps.vat_status INTO v_vat_status FROM public.pfa_settings ps WHERE ps.owner_user_id=v_user_id;
  v_source_value := CASE WHEN COALESCE(v_vat_status,'neinregistrat')='neinregistrat' THEN COALESCE(v_line.total_amount,0) ELSE COALESCE(v_line.net_amount,0) END;

  IF v_received_invoice.currency <> 'RON' THEN
    IF v_received_invoice.document_exchange_rate IS NULL OR v_received_invoice.document_exchange_rate_date IS NULL THEN
      RAISE EXCEPTION 'Mijlocul fix în % necesită cursul BNR al documentului',v_received_invoice.currency;
    END IF;
    v_exchange_rate := v_received_invoice.document_exchange_rate;
    v_exchange_rate_date := v_received_invoice.document_exchange_rate_date;
  END IF;

  v_acquisition_value := ROUND(v_source_value * v_exchange_rate,2);
  IF v_acquisition_value<=0 THEN RAISE EXCEPTION 'Valoare de achiziție invalidă'; END IF;

  IF p_depreciation_method NOT IN ('LINEAR','DEGRESSIVE','NONE') THEN RAISE EXCEPTION 'Metodă de amortizare invalidă'; END IF;
  IF p_depreciation_method<>'NONE' AND (p_useful_life_months IS NULL OR p_useful_life_months<=0) THEN RAISE EXCEPTION 'Durata de utilizare trebuie să fie pozitivă'; END IF;

  v_put_into_use_date:=COALESCE(p_commissioning_date,p_entry_date,v_received_invoice.document_date);
  v_legal_start_date:=(date_trunc('month',v_put_into_use_date::timestamp)::date+interval '1 month')::date;
  v_start_date:=CASE WHEN p_depreciation_method='NONE' THEN NULL WHEN p_depreciation_start_date IS NULL THEN v_legal_start_date ELSE GREATEST(date_trunc('month',p_depreciation_start_date::timestamp)::date,v_legal_start_date) END;

  IF p_depreciation_method='LINEAR' THEN
    v_monthly:=ROUND(v_acquisition_value/p_useful_life_months,2);
  ELSIF p_depreciation_method='DEGRESSIVE' THEN
    v_deg_coeff:=CASE WHEN p_useful_life_months<=60 THEN 1.5 WHEN p_useful_life_months<=120 THEN 2.0 ELSE 2.5 END;
    v_monthly:=ROUND(v_acquisition_value*v_deg_coeff/p_useful_life_months,2);
  END IF;

  INSERT INTO public.fixed_assets(
    owner_user_id,source_invoice_id,source_invoice_line_id,supplier_id,name,document_reference,
    asset_category,classification_code,serial_number,acquisition_date,entry_date,commissioning_date,
    put_into_use_date,acquisition_value,residual_value,currency,exchange_rate,exchange_rate_date,
    source_currency,source_amount,depreciation_method,useful_life,depreciation_start_date,
    monthly_depreciation,accumulated_depreciation,remaining_value,net_book_value,status,location,responsible_person,notes
  ) VALUES (
    v_user_id,v_received_invoice.id,p_received_invoice_line_id,v_received_invoice.supplier_id,p_name,
    'Factura '||COALESCE(v_received_invoice.series||'-','')||v_received_invoice.number,
    p_asset_category,p_classification_code,p_serial_number,v_received_invoice.document_date,
    COALESCE(p_entry_date,v_received_invoice.document_date),p_commissioning_date,v_put_into_use_date,
    v_acquisition_value,0,'RON',v_exchange_rate,v_exchange_rate_date,
    v_received_invoice.currency,v_source_value,p_depreciation_method,p_useful_life_months,v_start_date,
    v_monthly,0,v_acquisition_value,v_acquisition_value,
    CASE WHEN p_depreciation_method='NONE' THEN 'in_service' ELSE 'depreciating' END,
    p_location,p_responsible_person,p_notes
  ) RETURNING id INTO v_fixed_asset_id;

  PERFORM public.generate_inventory_number(v_fixed_asset_id);
  PERFORM public.write_audit_log('fixed_asset_created','fixed_asset',v_fixed_asset_id,
    jsonb_build_object('invoice_line_id',p_received_invoice_line_id,'source_amount',v_source_value,
      'source_currency',v_received_invoice.currency,'exchange_rate',v_exchange_rate,
      'exchange_rate_date',v_exchange_rate_date,'acquisition_value_ron',v_acquisition_value,
      'vat_status',v_vat_status,'depreciation_start_date',v_start_date));

  RETURN jsonb_build_object('success',true,'fixed_asset_id',v_fixed_asset_id,
    'source_amount',v_source_value,'source_currency',v_received_invoice.currency,
    'exchange_rate',v_exchange_rate,'exchange_rate_date',v_exchange_rate_date,
    'acquisition_value',v_acquisition_value,'currency','RON','monthly_depreciation',v_monthly,'depreciation_start_date',v_start_date);
END;
$function$;
