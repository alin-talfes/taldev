CREATE OR REPLACE FUNCTION public.set_received_invoice_exchange_rate(
  p_invoice_id uuid,
  p_exchange_rate numeric,
  p_exchange_rate_date date,
  p_source text DEFAULT 'MANUAL'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := public.get_auth_user_id();
  v_invoice public.received_invoices%ROWTYPE;
BEGIN
  SELECT * INTO v_invoice
  FROM public.received_invoices
  WHERE id = p_invoice_id AND owner_user_id = v_user_id
  FOR UPDATE;

  IF v_invoice.id IS NULL THEN RAISE EXCEPTION 'Factura primită nu există'; END IF;
  IF v_invoice.invoice_type <> 'NORMAL' OR v_invoice.document_status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Cursul nu poate fi setat pentru acest document';
  END IF;
  IF v_invoice.currency = 'RON' THEN RAISE EXCEPTION 'Factura este deja în RON'; END IF;
  IF p_exchange_rate IS NULL OR p_exchange_rate <= 0 THEN RAISE EXCEPTION 'Curs BNR invalid'; END IF;
  IF p_exchange_rate_date IS NULL OR p_exchange_rate_date >= v_invoice.document_date THEN
    RAISE EXCEPTION 'Data cursului BNR trebuie să fie o zi anterioară datei documentului';
  END IF;

  UPDATE public.received_invoices
  SET document_exchange_rate = ROUND(p_exchange_rate, 6),
      document_exchange_rate_date = p_exchange_rate_date,
      document_exchange_rate_source = COALESCE(NULLIF(BTRIM(p_source),''),'MANUAL'),
      updated_at = now()
  WHERE id = p_invoice_id;

  PERFORM public.write_audit_log(
    'received_invoice_exchange_rate_set','received_invoice',p_invoice_id,
    jsonb_build_object('currency',v_invoice.currency,'rate',ROUND(p_exchange_rate,6),'rate_date',p_exchange_rate_date,'source',p_source)
  );

  RETURN jsonb_build_object(
    'success',true,'invoice_id',p_invoice_id,'currency',v_invoice.currency,
    'exchange_rate',ROUND(p_exchange_rate,6),'exchange_rate_date',p_exchange_rate_date
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_fx_transaction(
  p_operation text,
  p_document_id uuid,
  p_amount numeric,
  p_transaction_date date,
  p_exchange_rate numeric,
  p_exchange_rate_date date,
  p_bank_amount_ron numeric DEFAULT NULL,
  p_payment_method text DEFAULT 'BANK',
  p_bank_account_id uuid DEFAULT NULL,
  p_fx_fiscal_treatment text DEFAULT NULL,
  p_fx_source text DEFAULT 'MANUAL',
  p_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := public.get_auth_user_id();
  v_operation text := UPPER(BTRIM(p_operation));
  v_direction text;
  v_type text;
  v_currency text;
  v_series text;
  v_number text;
  v_counterparty text;
  v_reference text;
  v_description text;
  v_balance numeric;
  v_paid numeric;
  v_available numeric;
  v_prior_refunds numeric := 0;
  v_amount numeric := ROUND(p_amount,2);
  v_amount_ron numeric;
  v_bank_currency text;
  v_transaction_id uuid;
  v_existing public.financial_transactions%ROWTYPE;
  v_fx_diff numeric;
BEGIN
  IF v_operation NOT IN ('RECEIPT','PAYMENT','INVOICE_REFUND','SUPPLIER_REFUND') THEN
    RAISE EXCEPTION 'Operațiune FX invalidă';
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'Suma trebuie să fie pozitivă'; END IF;
  IF p_transaction_date IS NULL THEN RAISE EXCEPTION 'Data operațiunii este obligatorie'; END IF;
  IF p_exchange_rate IS NULL OR p_exchange_rate <= 0 THEN RAISE EXCEPTION 'Curs BNR invalid'; END IF;
  IF p_exchange_rate_date IS NULL OR p_exchange_rate_date >= p_transaction_date THEN
    RAISE EXCEPTION 'Data cursului BNR trebuie să fie o zi anterioară operațiunii';
  END IF;
  IF p_payment_method NOT IN ('BANK','CASH','CARD','OTHER') THEN RAISE EXCEPTION 'Metodă de plată invalidă'; END IF;
  IF p_bank_amount_ron IS NOT NULL AND p_bank_amount_ron <= 0 THEN RAISE EXCEPTION 'Suma bancară în RON trebuie să fie pozitivă'; END IF;

  IF v_operation IN ('RECEIPT','INVOICE_REFUND') THEN
    SELECT i.currency, i.series, i.number::text, i.balance_due, i.paid_total,
           c.legal_name, i.document_status, i.invoice_type
    INTO v_currency, v_series, v_number, v_balance, v_paid, v_counterparty, v_reference, v_description
    FROM public.invoices i
    JOIN public.clients c ON c.id=i.client_id
    WHERE i.id=p_document_id AND i.owner_user_id=v_user_id
    FOR UPDATE OF i;

    IF v_currency IS NULL THEN RAISE EXCEPTION 'Factura nu există'; END IF;

    IF v_operation='RECEIPT' THEN
      IF v_reference <> 'ISSUED' OR v_description <> 'INVOICE' THEN RAISE EXCEPTION 'Factura nu poate fi încasată'; END IF;
      IF v_amount > v_balance THEN RAISE EXCEPTION 'Suma depășește soldul de încasat (%)',v_balance; END IF;
      v_direction:='IN'; v_type:='RECEIPT';
      v_reference := 'INV-'||COALESCE(v_series,'')||'-'||COALESCE(v_number,'');
      v_description := COALESCE(p_notes,'Încasare factură '||COALESCE(v_series,'')||'-'||COALESCE(v_number,''));
    ELSE
      IF v_reference NOT IN ('STORNED','CORRECTED','VOIDED') THEN RAISE EXCEPTION 'Refundul se înregistrează doar pentru o factură stornată/corectată/anulată'; END IF;
      SELECT COALESCE(SUM(ta.allocated_amount),0) INTO v_prior_refunds
      FROM public.transaction_allocations ta
      JOIN public.financial_transactions ft ON ft.id=ta.transaction_id
      WHERE ta.invoice_id=p_document_id AND ft.owner_user_id=v_user_id AND ft.status='CONFIRMED'
        AND ft.direction='OUT' AND ft.transaction_type='REFUND_OUT';
      v_available:=GREATEST(COALESCE(v_paid,0)-v_prior_refunds,0);
      IF v_amount > v_available THEN RAISE EXCEPTION 'Suma refundului depășește suma disponibilă (%)',v_available; END IF;
      v_direction:='OUT'; v_type:='REFUND_OUT';
      v_reference := 'REF-'||COALESCE(v_series,'')||'-'||COALESCE(v_number,'');
      v_description := COALESCE(p_notes,'Restituire factură '||COALESCE(v_series,'')||'-'||COALESCE(v_number,''));
    END IF;
  ELSE
    SELECT ri.currency, ri.series, ri.number, ri.balance_due, ri.paid_total,
           s.legal_name, ri.document_status, ri.invoice_type
    INTO v_currency, v_series, v_number, v_balance, v_paid, v_counterparty, v_reference, v_description
    FROM public.received_invoices ri
    JOIN public.suppliers s ON s.id=ri.supplier_id
    WHERE ri.id=p_document_id AND ri.owner_user_id=v_user_id
    FOR UPDATE OF ri;

    IF v_currency IS NULL THEN RAISE EXCEPTION 'Factura primită nu există'; END IF;

    IF v_operation='PAYMENT' THEN
      IF v_reference NOT IN ('RECEIVED','CONFIRMED') OR v_description <> 'NORMAL' THEN RAISE EXCEPTION 'Factura primită nu poate fi plătită'; END IF;
      IF v_amount > v_balance THEN RAISE EXCEPTION 'Suma depășește soldul de plată (%)',v_balance; END IF;
      v_direction:='OUT'; v_type:='PAYMENT';
      v_reference := 'PINV-'||COALESCE(v_series,'')||'-'||COALESCE(v_number,'');
      v_description := COALESCE(p_notes,'Plată factură '||COALESCE(v_series,'')||'-'||COALESCE(v_number,''));
    ELSE
      SELECT COALESCE(SUM(ta.allocated_amount),0) INTO v_prior_refunds
      FROM public.transaction_allocations ta
      JOIN public.financial_transactions ft ON ft.id=ta.transaction_id
      WHERE ta.received_invoice_id=p_document_id AND ft.owner_user_id=v_user_id AND ft.status='CONFIRMED'
        AND ft.direction='IN' AND ft.transaction_type='REFUND_IN';
      v_available:=GREATEST(COALESCE(v_paid,0)-v_prior_refunds,0);
      IF v_amount > v_available THEN RAISE EXCEPTION 'Suma refundului depășește suma disponibilă (%)',v_available; END IF;
      v_direction:='IN'; v_type:='REFUND_IN';
      v_reference := 'RFIN-'||COALESCE(v_series,'')||'-'||COALESCE(v_number,'');
      v_description := COALESCE(p_notes,'Refund furnizor factură '||COALESCE(v_series,'')||'-'||COALESCE(v_number,''));
    END IF;
  END IF;

  IF v_currency='RON' THEN RAISE EXCEPTION 'Pentru RON folosiți fluxul standard'; END IF;
  IF v_currency !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Monedă document invalidă'; END IF;

  IF p_bank_account_id IS NOT NULL THEN
    SELECT ba.currency INTO v_bank_currency
    FROM public.bank_accounts ba
    WHERE ba.id=p_bank_account_id AND ba.owner_user_id=v_user_id;
    IF v_bank_currency IS NULL THEN RAISE EXCEPTION 'Cont bancar invalid sau acces interzis'; END IF;
    IF v_bank_currency NOT IN ('RON',v_currency) THEN
      RAISE EXCEPTION 'Contul selectat trebuie să fie în RON sau %',v_currency;
    END IF;
    IF v_bank_currency='RON' AND p_payment_method IN ('BANK','CARD') AND p_bank_amount_ron IS NULL THEN
      RAISE EXCEPTION 'Pentru plata/încasarea printr-un cont RON trebuie introdusă suma efectivă debitată/creditată în RON';
    END IF;
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.financial_transactions
    WHERE owner_user_id=v_user_id AND idempotency_key=p_idempotency_key
    LIMIT 1;
    IF v_existing.id IS NOT NULL THEN
      IF v_existing.transaction_type<>v_type OR v_existing.direction<>v_direction OR v_existing.amount<>v_amount OR v_existing.currency<>v_currency THEN
        RAISE EXCEPTION 'Cheia de idempotency a fost folosită pentru o altă operațiune';
      END IF;
      RETURN jsonb_build_object('success',true,'transaction_id',v_existing.id,'reused',true,
        'amount',v_existing.amount,'currency',v_existing.currency,'amount_ron',v_existing.amount_ron,
        'bank_amount_ron',v_existing.bank_amount_ron,'fx_cash_difference_ron',v_existing.fx_cash_difference_ron);
    END IF;
  END IF;

  v_amount_ron := ROUND(v_amount * p_exchange_rate,2);
  v_fx_diff := CASE
    WHEN p_bank_amount_ron IS NULL THEN 0
    WHEN v_direction='IN' THEN ROUND(p_bank_amount_ron-v_amount_ron,2)
    ELSE ROUND(v_amount_ron-p_bank_amount_ron,2)
  END;

  IF v_fx_diff > 0 AND p_fx_fiscal_treatment IS NOT NULL AND p_fx_fiscal_treatment NOT IN ('INCOME','CASH_MOVEMENT') THEN
    RAISE EXCEPTION 'Tratament fiscal incompatibil cu diferența favorabilă';
  END IF;
  IF v_fx_diff < 0 AND p_fx_fiscal_treatment IS NOT NULL AND p_fx_fiscal_treatment NOT IN ('DEDUCTIBLE_EXPENSE','NON_DEDUCTIBLE_EXPENSE','CASH_MOVEMENT') THEN
    RAISE EXCEPTION 'Tratament fiscal incompatibil cu diferența nefavorabilă';
  END IF;

  INSERT INTO public.financial_transactions(
    owner_user_id,transaction_date,direction,transaction_type,amount,currency,payment_method,
    bank_account_id,description,counterparty_name,reference,status,idempotency_key,created_by,
    amount_ron,exchange_rate,exchange_rate_date,bank_amount_ron,fx_fiscal_treatment,fx_source
  ) VALUES (
    v_user_id,p_transaction_date,v_direction,v_type,v_amount,v_currency,p_payment_method,
    p_bank_account_id,v_description,v_counterparty,v_reference,'CONFIRMED',p_idempotency_key,v_user_id,
    v_amount_ron,ROUND(p_exchange_rate,6),p_exchange_rate_date,
    CASE WHEN p_bank_amount_ron IS NULL THEN NULL ELSE ROUND(p_bank_amount_ron,2) END,
    p_fx_fiscal_treatment,COALESCE(NULLIF(BTRIM(p_fx_source),''),'MANUAL')
  ) RETURNING id,amount_ron,fx_cash_difference_ron INTO v_transaction_id,v_amount_ron,v_fx_diff;

  IF v_operation IN ('RECEIPT','INVOICE_REFUND') THEN
    INSERT INTO public.transaction_allocations(transaction_id,invoice_id,allocated_amount,allocated_amount_ron)
    VALUES(v_transaction_id,p_document_id,v_amount,v_amount_ron);
  ELSE
    INSERT INTO public.transaction_allocations(transaction_id,received_invoice_id,allocated_amount,allocated_amount_ron)
    VALUES(v_transaction_id,p_document_id,v_amount,v_amount_ron);
  END IF;

  IF v_operation='RECEIPT' THEN
    UPDATE public.invoices
    SET paid_total=ROUND(paid_total+v_amount,2), balance_due=ROUND(balance_due-v_amount,2),
        payment_status=CASE WHEN ROUND(balance_due-v_amount,2)=0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
        updated_at=now()
    WHERE id=p_document_id;
  ELSIF v_operation='PAYMENT' THEN
    UPDATE public.received_invoices
    SET paid_total=ROUND(paid_total+v_amount,2), balance_due=ROUND(balance_due-v_amount,2),
        payment_status=CASE WHEN ROUND(balance_due-v_amount,2)=0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
        updated_at=now()
    WHERE id=p_document_id;
  END IF;

  PERFORM public.write_audit_log(
    lower(v_operation)||'_fx_registered',
    CASE WHEN v_operation IN ('RECEIPT','INVOICE_REFUND') THEN 'invoice' ELSE 'received_invoice' END,
    p_document_id,
    jsonb_build_object('transaction_id',v_transaction_id,'amount',v_amount,'currency',v_currency,
      'exchange_rate',ROUND(p_exchange_rate,6),'exchange_rate_date',p_exchange_rate_date,
      'amount_ron',v_amount_ron,'bank_amount_ron',p_bank_amount_ron,'fx_cash_difference_ron',v_fx_diff,
      'fx_fiscal_treatment',p_fx_fiscal_treatment)
  );

  RETURN jsonb_build_object(
    'success',true,'transaction_id',v_transaction_id,'operation',v_operation,
    'amount',v_amount,'currency',v_currency,'amount_ron',v_amount_ron,
    'exchange_rate',ROUND(p_exchange_rate,6),'exchange_rate_date',p_exchange_rate_date,
    'bank_amount_ron',CASE WHEN p_bank_amount_ron IS NULL THEN NULL ELSE ROUND(p_bank_amount_ron,2) END,
    'fx_cash_difference_ron',v_fx_diff,'fx_fiscal_treatment',p_fx_fiscal_treatment
  );
END;
$function$;
