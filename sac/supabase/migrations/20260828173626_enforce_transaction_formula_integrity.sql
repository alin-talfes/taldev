ALTER TABLE public.financial_transactions
  DROP CONSTRAINT IF EXISTS financial_transactions_direction_type_coherence;
ALTER TABLE public.financial_transactions
  ADD CONSTRAINT financial_transactions_direction_type_coherence CHECK (
    (transaction_type IN ('RECEIPT','REFUND_IN','OTHER_IN','OWN_CONTRIBUTION') AND direction='IN')
    OR (transaction_type IN ('PAYMENT','REFUND_OUT','OTHER_OUT','OWN_CONTRIBUTION_RETURN') AND direction='OUT')
    OR transaction_type='ADJUSTMENT'
  );

CREATE OR REPLACE FUNCTION public.cancel_other_operation(p_transaction_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE v_user_id uuid:=auth.uid(); v_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Utilizator neautentificat'; END IF;
  SELECT ft.id INTO v_id
  FROM public.financial_transactions ft
  WHERE ft.id=p_transaction_id AND ft.owner_user_id=v_user_id AND ft.status='CONFIRMED'
    AND ft.transaction_type IN ('OTHER_IN','OTHER_OUT','ADJUSTMENT','OWN_CONTRIBUTION','OWN_CONTRIBUTION_RETURN')
    AND NOT EXISTS (SELECT 1 FROM public.transaction_allocations ta WHERE ta.transaction_id=ft.id)
  FOR UPDATE;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Operațiunea nu există, este deja anulată sau nu poate fi anulată prin acest modul'; END IF;
  UPDATE public.financial_transactions SET status='CANCELLED',updated_at=now() WHERE id=v_id;
  RETURN jsonb_build_object('success',true,'transaction_id',v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.register_manual_transaction(
 p_direction text,p_transaction_type text,p_amount numeric,p_transaction_date date,
 p_currency text DEFAULT 'RON',p_payment_method text DEFAULT 'BANK',p_bank_account_id uuid DEFAULT NULL,
 p_description text DEFAULT NULL,p_counterparty_name text DEFAULT NULL,p_reference text DEFAULT NULL,
 p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE v_user_id uuid; v_transaction_id uuid; v_existing record; v_amount numeric;
BEGIN
  v_user_id:=public.get_auth_user_id(); v_amount:=ROUND(p_amount,2);
  IF p_transaction_type NOT IN ('OTHER_IN','OTHER_OUT','ADJUSTMENT','OWN_CONTRIBUTION','OWN_CONTRIBUTION_RETURN') THEN
    RAISE EXCEPTION 'Pentru încasări/plăți/refunduri legate de facturi folosiți funcția dedicată';
  END IF;
  IF p_direction NOT IN ('IN','OUT') THEN RAISE EXCEPTION 'Direcție invalidă'; END IF;
  IF (p_transaction_type IN ('OTHER_IN','OWN_CONTRIBUTION') AND p_direction<>'IN')
     OR (p_transaction_type IN ('OTHER_OUT','OWN_CONTRIBUTION_RETURN') AND p_direction<>'OUT') THEN
    RAISE EXCEPTION 'Direcția nu corespunde tipului tranzacției';
  END IF;
  IF v_amount<=0 THEN RAISE EXCEPTION 'Suma trebuie să fie pozitivă'; END IF;
  IF p_bank_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.bank_accounts WHERE id=p_bank_account_id AND owner_user_id=v_user_id
  ) THEN RAISE EXCEPTION 'Cont bancar invalid sau acces interzis'; END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.financial_transactions
    WHERE owner_user_id=v_user_id AND idempotency_key=p_idempotency_key LIMIT 1;
    IF v_existing IS NOT NULL THEN
      IF v_existing.direction<>p_direction OR v_existing.transaction_type<>p_transaction_type OR v_existing.amount<>v_amount THEN
        RAISE EXCEPTION 'Cheia de idempotency a fost folosită pentru o altă operațiune';
      END IF;
      RETURN jsonb_build_object('success',true,'transaction_id',v_existing.id,'reused',true);
    END IF;
  END IF;
  INSERT INTO public.financial_transactions(owner_user_id,transaction_date,direction,transaction_type,amount,currency,
    payment_method,bank_account_id,description,counterparty_name,reference,status,idempotency_key,created_by)
  VALUES(v_user_id,p_transaction_date,p_direction,p_transaction_type,v_amount,p_currency,p_payment_method,p_bank_account_id,
    COALESCE(p_description,p_transaction_type),p_counterparty_name,p_reference,'CONFIRMED',p_idempotency_key,v_user_id)
  RETURNING id INTO v_transaction_id;
  PERFORM public.write_audit_log('manual_transaction','financial_transaction',v_transaction_id,
    jsonb_build_object('direction',p_direction,'amount',v_amount,'type',p_transaction_type));
  RETURN jsonb_build_object('success',true,'transaction_id',v_transaction_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.save_other_operation(
 p_id uuid,p_direction text,p_transaction_type text,p_amount numeric,p_transaction_date date,
 p_currency text DEFAULT 'RON',p_payment_method text DEFAULT 'BANK',p_bank_account_id uuid DEFAULT NULL,
 p_description text DEFAULT NULL,p_category text DEFAULT NULL,p_fiscal_treatment text DEFAULT NULL,
 p_document_type text DEFAULT NULL,p_document_number text DEFAULT NULL,p_document_date date DEFAULT NULL,
 p_notes text DEFAULT NULL,p_counterparty_name text DEFAULT NULL,p_reference text DEFAULT NULL,
 p_deductibility_percent numeric DEFAULT NULL,p_deductibility_limit numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE v_user_id uuid:=auth.uid(); v_transaction_id uuid; v_existing record; v_amount numeric;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Utilizator neautentificat'; END IF;
  v_amount:=ROUND(p_amount,2);
  IF p_direction NOT IN ('IN','OUT') THEN RAISE EXCEPTION 'Direcție invalidă'; END IF;
  IF p_transaction_type NOT IN ('OTHER_IN','OTHER_OUT','ADJUSTMENT') THEN RAISE EXCEPTION 'Tip tranzacție invalid pentru alte încasări/cheltuieli'; END IF;
  IF (p_transaction_type='OTHER_IN' AND p_direction<>'IN') OR (p_transaction_type='OTHER_OUT' AND p_direction<>'OUT') THEN
    RAISE EXCEPTION 'Direcția nu corespunde tipului tranzacției';
  END IF;
  IF v_amount<=0 THEN RAISE EXCEPTION 'Suma trebuie să fie pozitivă'; END IF;
  IF p_fiscal_treatment IS NOT NULL AND p_fiscal_treatment NOT IN ('INCOME','DEDUCTIBLE_EXPENSE','NON_DEDUCTIBLE_EXPENSE','CASH_MOVEMENT') THEN
    RAISE EXCEPTION 'Tratament fiscal invalid';
  END IF;
  IF p_deductibility_percent IS NOT NULL AND (p_deductibility_percent<0 OR p_deductibility_percent>100) THEN RAISE EXCEPTION 'Procent deductibilitate invalid'; END IF;
  IF p_deductibility_limit IS NOT NULL AND p_deductibility_limit<0 THEN RAISE EXCEPTION 'Plafon deductibilitate invalid'; END IF;
  IF p_bank_account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.bank_accounts WHERE id=p_bank_account_id AND owner_user_id=v_user_id) THEN
    RAISE EXCEPTION 'Cont bancar invalid sau acces interzis';
  END IF;
  IF p_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.financial_transactions
    WHERE id=p_id AND owner_user_id=v_user_id AND status='CONFIRMED'
      AND transaction_type IN ('OTHER_IN','OTHER_OUT','ADJUSTMENT')
      AND NOT EXISTS (SELECT 1 FROM public.transaction_allocations ta WHERE ta.transaction_id=p_id)
    FOR UPDATE;
    IF v_existing IS NULL THEN RAISE EXCEPTION 'Operațiunea nu există sau nu poate fi modificată'; END IF;
    UPDATE public.financial_transactions SET direction=p_direction,transaction_type=p_transaction_type,amount=v_amount,
      transaction_date=p_transaction_date,currency=p_currency,payment_method=p_payment_method,bank_account_id=p_bank_account_id,
      description=COALESCE(p_description,p_transaction_type),category=p_category,fiscal_treatment=p_fiscal_treatment,
      document_type=p_document_type,document_number=p_document_number,document_date=p_document_date,notes=p_notes,
      counterparty_name=p_counterparty_name,reference=p_reference,deductibility_percent=p_deductibility_percent,
      deductibility_limit=p_deductibility_limit,updated_at=now()
    WHERE id=p_id RETURNING id INTO v_transaction_id;
  ELSE
    INSERT INTO public.financial_transactions(owner_user_id,direction,transaction_type,amount,transaction_date,currency,payment_method,
      bank_account_id,description,category,fiscal_treatment,document_type,document_number,document_date,notes,counterparty_name,
      reference,status,deductibility_percent,deductibility_limit,idempotency_key,created_by)
    VALUES(v_user_id,p_direction,p_transaction_type,v_amount,p_transaction_date,p_currency,p_payment_method,p_bank_account_id,
      COALESCE(p_description,p_transaction_type),p_category,p_fiscal_treatment,p_document_type,p_document_number,p_document_date,p_notes,
      p_counterparty_name,p_reference,'CONFIRMED',p_deductibility_percent,p_deductibility_limit,gen_random_uuid()::text,v_user_id)
    RETURNING id INTO v_transaction_id;
  END IF;
  RETURN v_transaction_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_receipt(
 p_invoice_id uuid,p_amount numeric,p_transaction_date date DEFAULT CURRENT_DATE,p_payment_method text DEFAULT 'BANK',
 p_bank_account_id uuid DEFAULT NULL,p_notes text DEFAULT NULL,p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user_id uuid; v_invoice record; v_transaction_id uuid; v_existing record; v_amount numeric;
BEGIN
  v_user_id:=public.get_auth_user_id(); v_amount:=ROUND(p_amount,2);
  IF v_amount<=0 THEN RAISE EXCEPTION 'Suma trebuie să fie pozitivă'; END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
  IF v_invoice IS NULL THEN RAISE EXCEPTION 'Factura nu există'; END IF;
  IF v_invoice.owner_user_id<>v_user_id THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_invoice.document_status<>'ISSUED' OR v_invoice.invoice_type<>'INVOICE' THEN RAISE EXCEPTION 'Factura nu este o factură normală emisă'; END IF;
  IF p_bank_account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.bank_accounts WHERE id=p_bank_account_id AND owner_user_id=v_user_id) THEN RAISE EXCEPTION 'Cont bancar invalid sau acces interzis'; END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.financial_transactions WHERE owner_user_id=v_user_id AND idempotency_key=p_idempotency_key LIMIT 1;
    IF v_existing IS NOT NULL THEN
      IF v_existing.transaction_type<>'RECEIPT' OR v_existing.direction<>'IN' OR v_existing.amount<>v_amount
         OR NOT EXISTS (SELECT 1 FROM public.transaction_allocations WHERE transaction_id=v_existing.id AND invoice_id=p_invoice_id AND allocated_amount=v_amount) THEN
        RAISE EXCEPTION 'Cheia de idempotency a fost folosită pentru o altă operațiune';
      END IF;
      RETURN jsonb_build_object('success',true,'transaction_id',v_existing.id,'reused',true);
    END IF;
  END IF;
  IF v_amount>v_invoice.balance_due THEN RAISE EXCEPTION 'Suma depășește soldul de încasat (%)',v_invoice.balance_due; END IF;
  INSERT INTO public.financial_transactions(owner_user_id,transaction_date,direction,transaction_type,amount,currency,payment_method,
    bank_account_id,description,counterparty_name,reference,status,idempotency_key,created_by)
  VALUES(v_user_id,p_transaction_date,'IN','RECEIPT',v_amount,v_invoice.currency,p_payment_method,p_bank_account_id,
    COALESCE(p_notes,'Încasare factură '||v_invoice.series||'-'||v_invoice.number),
    (SELECT legal_name FROM public.clients WHERE id=v_invoice.client_id),'INV-'||v_invoice.series||'-'||v_invoice.number,
    'CONFIRMED',p_idempotency_key,v_user_id) RETURNING id INTO v_transaction_id;
  INSERT INTO public.transaction_allocations(transaction_id,invoice_id,allocated_amount) VALUES(v_transaction_id,p_invoice_id,v_amount);
  UPDATE public.invoices SET paid_total=ROUND(paid_total+v_amount,2),balance_due=ROUND(balance_due-v_amount,2),
    payment_status=CASE WHEN ROUND(balance_due-v_amount,2)=0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,updated_at=now()
  WHERE id=p_invoice_id;
  PERFORM public.write_audit_log('receipt_registered','invoice',p_invoice_id,jsonb_build_object('transaction_id',v_transaction_id,'amount',v_amount));
  RETURN jsonb_build_object('success',true,'transaction_id',v_transaction_id);
END; $$;

CREATE OR REPLACE FUNCTION public.register_payment(
 p_received_invoice_id uuid,p_amount numeric,p_transaction_date date DEFAULT CURRENT_DATE,p_payment_method text DEFAULT 'BANK',
 p_bank_account_id uuid DEFAULT NULL,p_notes text DEFAULT NULL,p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user_id uuid; v_invoice record; v_transaction_id uuid; v_existing record; v_amount numeric;
BEGIN
  v_user_id:=public.get_auth_user_id(); v_amount:=ROUND(p_amount,2);
  IF v_amount<=0 THEN RAISE EXCEPTION 'Suma trebuie să fie pozitivă'; END IF;
  SELECT * INTO v_invoice FROM public.received_invoices WHERE id=p_received_invoice_id FOR UPDATE;
  IF v_invoice IS NULL THEN RAISE EXCEPTION 'Factura primită nu există'; END IF;
  IF v_invoice.owner_user_id<>v_user_id THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_invoice.document_status NOT IN ('RECEIVED','CONFIRMED') OR v_invoice.invoice_type<>'NORMAL' THEN RAISE EXCEPTION 'Factura primită nu poate fi plătită'; END IF;
  IF p_bank_account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.bank_accounts WHERE id=p_bank_account_id AND owner_user_id=v_user_id) THEN RAISE EXCEPTION 'Cont bancar invalid sau acces interzis'; END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.financial_transactions WHERE owner_user_id=v_user_id AND idempotency_key=p_idempotency_key LIMIT 1;
    IF v_existing IS NOT NULL THEN
      IF v_existing.transaction_type<>'PAYMENT' OR v_existing.direction<>'OUT' OR v_existing.amount<>v_amount
         OR NOT EXISTS (SELECT 1 FROM public.transaction_allocations WHERE transaction_id=v_existing.id AND received_invoice_id=p_received_invoice_id AND allocated_amount=v_amount) THEN
        RAISE EXCEPTION 'Cheia de idempotency a fost folosită pentru o altă operațiune';
      END IF;
      RETURN jsonb_build_object('success',true,'transaction_id',v_existing.id,'reused',true);
    END IF;
  END IF;
  IF v_amount>v_invoice.balance_due THEN RAISE EXCEPTION 'Suma depășește soldul de plată (%)',v_invoice.balance_due; END IF;
  INSERT INTO public.financial_transactions(owner_user_id,transaction_date,direction,transaction_type,amount,currency,payment_method,
    bank_account_id,description,counterparty_name,reference,status,idempotency_key,created_by)
  VALUES(v_user_id,p_transaction_date,'OUT','PAYMENT',v_amount,v_invoice.currency,p_payment_method,p_bank_account_id,
    COALESCE(p_notes,'Plată factură '||v_invoice.series||'-'||v_invoice.number),
    (SELECT legal_name FROM public.suppliers WHERE id=v_invoice.supplier_id),'PINV-'||v_invoice.series||'-'||v_invoice.number,
    'CONFIRMED',p_idempotency_key,v_user_id) RETURNING id INTO v_transaction_id;
  INSERT INTO public.transaction_allocations(transaction_id,received_invoice_id,allocated_amount) VALUES(v_transaction_id,p_received_invoice_id,v_amount);
  UPDATE public.received_invoices SET paid_total=ROUND(paid_total+v_amount,2),balance_due=ROUND(balance_due-v_amount,2),
    payment_status=CASE WHEN ROUND(balance_due-v_amount,2)=0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,updated_at=now()
  WHERE id=p_received_invoice_id;
  PERFORM public.write_audit_log('payment_registered','received_invoice',p_received_invoice_id,jsonb_build_object('transaction_id',v_transaction_id,'amount',v_amount));
  RETURN jsonb_build_object('success',true,'transaction_id',v_transaction_id);
END; $$;
