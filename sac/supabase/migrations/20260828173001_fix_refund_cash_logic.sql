CREATE OR REPLACE FUNCTION public.create_storno_invoice(
    p_original_invoice_id uuid,
    p_storno_type text DEFAULT 'STORNO'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid;
    v_original record;
    v_invoice_id uuid;
    v_total numeric;
    v_refund_due numeric;
BEGIN
    v_user_id := public.get_auth_user_id();

    SELECT * INTO v_original
    FROM public.invoices
    WHERE id = p_original_invoice_id
    FOR UPDATE;

    IF v_original IS NULL THEN
        RAISE EXCEPTION 'Factura originală nu există';
    END IF;
    IF v_original.owner_user_id <> v_user_id THEN
        RAISE EXCEPTION 'Access denied';
    END IF;
    IF v_original.document_status NOT IN ('ISSUED','CORRECTED') THEN
        RAISE EXCEPTION 'Factura originală nu este emisă';
    END IF;
    IF p_storno_type NOT IN ('CORRECTION','STORNO') THEN
        RAISE EXCEPTION 'Tip document corectiv invalid';
    END IF;

    v_total := -v_original.total;
    v_refund_due := COALESCE(v_original.paid_total,0);

    INSERT INTO public.invoices (
        owner_user_id,series_id,series,number,issue_date,due_date,
        invoice_type,document_status,payment_status,xml_status,efactura_status,
        client_id,currency,subtotal,discount_total,taxable_base,vat_total,total,
        paid_total,balance_due,notes,payment_terms,corrects_invoice_id,created_by
    ) VALUES (
        v_user_id,NULL,NULL,NULL,CURRENT_DATE,CURRENT_DATE,
        p_storno_type,'DRAFT','PAID','NOT_GENERATED','NOT_SUBMITTED',
        v_original.client_id,v_original.currency,
        -v_original.subtotal,-v_original.discount_total,
        -v_original.taxable_base,-v_original.vat_total,v_total,
        v_total,0,
        COALESCE('Storno factură ' || v_original.series || '-' || v_original.number,'Storno'),
        v_original.payment_terms,p_original_invoice_id,v_user_id
    ) RETURNING id INTO v_invoice_id;

    INSERT INTO public.invoice_lines (
        invoice_id,position,description,quantity,unit,unit_price,
        discount,vat_rate,vat_category,net_amount,vat_amount,total_amount
    )
    SELECT
        v_invoice_id,position,description,-quantity,unit,unit_price,
        -discount,vat_rate,vat_category,-net_amount,-vat_amount,-total_amount
    FROM public.invoice_lines
    WHERE invoice_id=p_original_invoice_id
    ORDER BY position;

    UPDATE public.invoices
    SET corrected_by_invoice_id=v_invoice_id,
        document_status=CASE WHEN p_storno_type='STORNO' THEN 'STORNED' ELSE 'CORRECTED' END,
        updated_at=now()
    WHERE id=p_original_invoice_id;

    -- IMPORTANT: nu generăm o tranzacție de refund la simpla emitere a stornoului.
    -- Cashflow-ul se modifică doar când banii sunt efectiv restituiți.
    PERFORM public.write_audit_log(
        'storno_created','invoice',v_invoice_id,
        jsonb_build_object(
            'original_invoice_id',p_original_invoice_id,
            'type',p_storno_type,
            'refund_due',v_refund_due
        )
    );

    RETURN jsonb_build_object(
        'success',true,
        'invoice_id',v_invoice_id,
        'original_invoice_id',p_original_invoice_id,
        'refund_due',v_refund_due
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.register_invoice_refund(
    p_invoice_id uuid,
    p_amount numeric,
    p_transaction_date date DEFAULT CURRENT_DATE,
    p_payment_method text DEFAULT 'BANK',
    p_bank_account_id uuid DEFAULT NULL,
    p_notes text DEFAULT NULL,
    p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid;
    v_invoice record;
    v_transaction_id uuid;
    v_existing record;
    v_refunded numeric := 0;
    v_available numeric := 0;
BEGIN
    v_user_id := public.get_auth_user_id();

    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing
        FROM public.financial_transactions
        WHERE owner_user_id=v_user_id AND idempotency_key=p_idempotency_key
        LIMIT 1;
        IF v_existing IS NOT NULL THEN
            RETURN jsonb_build_object('success',true,'transaction_id',v_existing.id,'reused',true);
        END IF;
    END IF;

    SELECT * INTO v_invoice
    FROM public.invoices
    WHERE id=p_invoice_id AND owner_user_id=v_user_id
    FOR UPDATE;

    IF v_invoice IS NULL THEN
        RAISE EXCEPTION 'Factura nu există';
    END IF;
    IF v_invoice.document_status NOT IN ('STORNED','CORRECTED','VOIDED') THEN
        RAISE EXCEPTION 'Refundul se înregistrează pentru o factură stornată/corectată/anulată';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Suma trebuie să fie pozitivă';
    END IF;

    IF p_bank_account_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.bank_accounts ba
        WHERE ba.id=p_bank_account_id AND ba.owner_user_id=v_user_id
    ) THEN
        RAISE EXCEPTION 'Cont bancar invalid sau acces interzis';
    END IF;

    SELECT COALESCE(SUM(ta.allocated_amount),0)
    INTO v_refunded
    FROM public.transaction_allocations ta
    JOIN public.financial_transactions ft ON ft.id=ta.transaction_id
    WHERE ta.invoice_id=p_invoice_id
      AND ft.owner_user_id=v_user_id
      AND ft.status='CONFIRMED'
      AND ft.direction='OUT'
      AND ft.transaction_type='REFUND_OUT';

    v_available := GREATEST(COALESCE(v_invoice.paid_total,0)-v_refunded,0);
    IF p_amount > v_available THEN
        RAISE EXCEPTION 'Suma refundului depășește suma disponibilă pentru restituire (%)',v_available;
    END IF;

    INSERT INTO public.financial_transactions (
        owner_user_id,transaction_date,direction,transaction_type,amount,currency,
        payment_method,bank_account_id,description,counterparty_name,reference,status,
        idempotency_key,created_by
    ) VALUES (
        v_user_id,p_transaction_date,'OUT','REFUND_OUT',ROUND(p_amount,2),v_invoice.currency,
        p_payment_method,p_bank_account_id,
        COALESCE(p_notes,'Restituire factură ' || COALESCE(v_invoice.series,'') || '-' || COALESCE(v_invoice.number::text,'')),
        (SELECT c.legal_name FROM public.clients c WHERE c.id=v_invoice.client_id),
        'REF-' || COALESCE(v_invoice.series,'') || '-' || COALESCE(v_invoice.number::text,''),
        'CONFIRMED',p_idempotency_key,v_user_id
    ) RETURNING id INTO v_transaction_id;

    INSERT INTO public.transaction_allocations(transaction_id,invoice_id,allocated_amount)
    VALUES(v_transaction_id,p_invoice_id,ROUND(p_amount,2));

    PERFORM public.write_audit_log(
        'invoice_refund_registered','invoice',p_invoice_id,
        jsonb_build_object('transaction_id',v_transaction_id,'amount',ROUND(p_amount,2))
    );

    RETURN jsonb_build_object(
        'success',true,
        'transaction_id',v_transaction_id,
        'amount',ROUND(p_amount,2),
        'remaining_refundable',ROUND(v_available-p_amount,2)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.register_supplier_refund(
    p_received_invoice_id uuid,
    p_amount numeric,
    p_transaction_date date DEFAULT CURRENT_DATE,
    p_payment_method text DEFAULT 'BANK',
    p_bank_account_id uuid DEFAULT NULL,
    p_notes text DEFAULT NULL,
    p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid;
    v_invoice record;
    v_transaction_id uuid;
    v_existing record;
    v_refunded numeric := 0;
    v_available numeric := 0;
BEGIN
    v_user_id := public.get_auth_user_id();

    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing
        FROM public.financial_transactions
        WHERE owner_user_id=v_user_id AND idempotency_key=p_idempotency_key
        LIMIT 1;
        IF v_existing IS NOT NULL THEN
            RETURN jsonb_build_object('success',true,'transaction_id',v_existing.id,'reused',true);
        END IF;
    END IF;

    SELECT * INTO v_invoice
    FROM public.received_invoices
    WHERE id=p_received_invoice_id AND owner_user_id=v_user_id
    FOR UPDATE;

    IF v_invoice IS NULL THEN
        RAISE EXCEPTION 'Factura primită nu există';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Suma trebuie să fie pozitivă';
    END IF;

    IF p_bank_account_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.bank_accounts ba
        WHERE ba.id=p_bank_account_id AND ba.owner_user_id=v_user_id
    ) THEN
        RAISE EXCEPTION 'Cont bancar invalid sau acces interzis';
    END IF;

    SELECT COALESCE(SUM(ta.allocated_amount),0)
    INTO v_refunded
    FROM public.transaction_allocations ta
    JOIN public.financial_transactions ft ON ft.id=ta.transaction_id
    WHERE ta.received_invoice_id=p_received_invoice_id
      AND ft.owner_user_id=v_user_id
      AND ft.status='CONFIRMED'
      AND ft.direction='IN'
      AND ft.transaction_type='REFUND_IN';

    v_available := GREATEST(COALESCE(v_invoice.paid_total,0)-v_refunded,0);
    IF p_amount > v_available THEN
        RAISE EXCEPTION 'Suma refundului depășește suma plătită disponibilă pentru recuperare (%)',v_available;
    END IF;

    INSERT INTO public.financial_transactions (
        owner_user_id,transaction_date,direction,transaction_type,amount,currency,
        payment_method,bank_account_id,description,counterparty_name,reference,status,
        idempotency_key,created_by
    ) VALUES (
        v_user_id,p_transaction_date,'IN','REFUND_IN',ROUND(p_amount,2),v_invoice.currency,
        p_payment_method,p_bank_account_id,
        COALESCE(p_notes,'Refund furnizor factură ' || COALESCE(v_invoice.series,'') || '-' || v_invoice.number),
        (SELECT s.legal_name FROM public.suppliers s WHERE s.id=v_invoice.supplier_id),
        'RFIN-' || COALESCE(v_invoice.series,'') || '-' || v_invoice.number,
        'CONFIRMED',p_idempotency_key,v_user_id
    ) RETURNING id INTO v_transaction_id;

    INSERT INTO public.transaction_allocations(transaction_id,received_invoice_id,allocated_amount)
    VALUES(v_transaction_id,p_received_invoice_id,ROUND(p_amount,2));

    PERFORM public.write_audit_log(
        'supplier_refund_registered','received_invoice',p_received_invoice_id,
        jsonb_build_object('transaction_id',v_transaction_id,'amount',ROUND(p_amount,2))
    );

    RETURN jsonb_build_object(
        'success',true,
        'transaction_id',v_transaction_id,
        'amount',ROUND(p_amount,2),
        'remaining_refundable',ROUND(v_available-p_amount,2)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_invoice_refund(uuid,numeric,date,text,uuid,text,text) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.register_supplier_refund(uuid,numeric,date,text,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_invoice_refund(uuid,numeric,date,text,uuid,text,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.register_supplier_refund(uuid,numeric,date,text,uuid,text,text) TO authenticated,service_role;

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
               LEAST(
                 ROUND(t.amount*COALESCE(t.deductibility_percent,100)/100.0,2),
                 COALESCE(t.deductibility_limit,ROUND(t.amount*COALESCE(t.deductibility_percent,100)/100.0,2))
               )
             ELSE 0::numeric
           END AS manual_deductible,
           CASE
             WHEN t.transaction_type NOT IN ('PAYMENT','REFUND_IN') AND t.fiscal_treatment='DEDUCTIBLE_EXPENSE' THEN
               (CASE WHEN t.direction='OUT' THEN 1 ELSE -1 END) *
               GREATEST(t.amount-LEAST(
                 ROUND(t.amount*COALESCE(t.deductibility_percent,100)/100.0,2),
                 COALESCE(t.deductibility_limit,ROUND(t.amount*COALESCE(t.deductibility_percent,100)/100.0,2))
               ),0)
             WHEN t.transaction_type NOT IN ('PAYMENT','REFUND_IN') AND t.fiscal_treatment='NON_DEDUCTIBLE_EXPENSE' THEN
               CASE WHEN t.direction='OUT' THEN t.amount ELSE -t.amount END
             ELSE 0::numeric
           END AS manual_non_deductible,
           CASE WHEN t.transaction_type='OWN_CONTRIBUTION' THEN t.amount ELSE 0::numeric END AS owner_contributions,
           CASE WHEN t.transaction_type='OWN_CONTRIBUTION_RETURN' THEN t.amount ELSE 0::numeric END AS owner_withdrawals
    FROM tx_base t
),
allocation_base AS (
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
          WHEN ri.deductible_status IN ('DEDUCTIBLE','PARTIALLY_DEDUCTIBLE') THEN
            CASE
              WHEN ft.direction='OUT' AND ft.transaction_type='PAYMENT' THEN
                ROUND(ta.allocated_amount*COALESCE(ri.deductibility_percent,100)/100.0,2)
              WHEN ft.direction='IN' AND ft.transaction_type='REFUND_IN' THEN
                -ROUND(ta.allocated_amount*COALESCE(ri.deductibility_percent,100)/100.0,2)
            END
          ELSE 0::numeric
        END AS candidate_deductible
    FROM public.financial_transactions ft
    JOIN public.transaction_allocations ta ON ta.transaction_id=ft.id
    JOIN public.received_invoices ri ON ri.id=ta.received_invoice_id
    WHERE ft.status='CONFIRMED'
      AND ((ft.direction='OUT' AND ft.transaction_type='PAYMENT')
        OR (ft.direction='IN' AND ft.transaction_type='REFUND_IN'))
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
               ROUND(
                 CASE WHEN ar.deductibility_limit IS NULL THEN
                   GREATEST(ar.previous_candidate+ar.candidate_deductible,0)-GREATEST(ar.previous_candidate,0)
                 ELSE
                   LEAST(ar.deductibility_limit,GREATEST(ar.previous_candidate+ar.candidate_deductible,0))
                   - LEAST(ar.deductibility_limit,GREATEST(ar.previous_candidate,0))
                 END,2)
             ELSE 0::numeric
           END AS deductible_expense,
           CASE
             WHEN ar.deductible_status IN ('DEDUCTIBLE','PARTIALLY_DEDUCTIBLE') THEN
               ROUND(ar.signed_allocated - (
                 CASE WHEN ar.deductibility_limit IS NULL THEN
                   GREATEST(ar.previous_candidate+ar.candidate_deductible,0)-GREATEST(ar.previous_candidate,0)
                 ELSE
                   LEAST(ar.deductibility_limit,GREATEST(ar.previous_candidate+ar.candidate_deductible,0))
                   - LEAST(ar.deductibility_limit,GREATEST(ar.previous_candidate,0))
                 END
               ),2)
             WHEN ar.deductible_status='NON_DEDUCTIBLE' THEN ar.signed_allocated
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
           manual_deductible AS deductible_expenses,
           manual_non_deductible AS non_deductible_expenses,
           0::numeric AS depreciation,owner_contributions,owner_withdrawals
    FROM tx_fiscal
    UNION ALL
    SELECT owner_user_id,month_start,year,month,0::numeric,
           deductible_expense,non_deductible_expense,0::numeric,0::numeric,0::numeric
    FROM allocation_classified
    UNION ALL
    SELECT owner_user_id,month_start,year,month,0::numeric,0::numeric,0::numeric,
           depreciation,0::numeric,0::numeric
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
