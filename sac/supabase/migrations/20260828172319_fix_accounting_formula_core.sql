-- Integrity constraints for percentage/limit based deductibility.
ALTER TABLE public.received_invoices
  DROP CONSTRAINT IF EXISTS received_invoices_deductibility_percent_check,
  DROP CONSTRAINT IF EXISTS received_invoices_deductibility_limit_check;
ALTER TABLE public.received_invoices
  ADD CONSTRAINT received_invoices_deductibility_percent_check
    CHECK (deductibility_percent IS NULL OR (deductibility_percent >= 0 AND deductibility_percent <= 100)),
  ADD CONSTRAINT received_invoices_deductibility_limit_check
    CHECK (deductibility_limit IS NULL OR deductibility_limit >= 0);

ALTER TABLE public.financial_transactions
  DROP CONSTRAINT IF EXISTS financial_transactions_deductibility_percent_check,
  DROP CONSTRAINT IF EXISTS financial_transactions_deductibility_limit_check;
ALTER TABLE public.financial_transactions
  ADD CONSTRAINT financial_transactions_deductibility_percent_check
    CHECK (deductibility_percent IS NULL OR (deductibility_percent >= 0 AND deductibility_percent <= 100)),
  ADD CONSTRAINT financial_transactions_deductibility_limit_check
    CHECK (deductibility_limit IS NULL OR deductibility_limit >= 0);

-- A storno/correction must be able to carry the discount with negative sign
-- so that total = subtotal - discount + VAT remains algebraically correct.
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_discount_total_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_discount_total_check
  CHECK (discount_total >= 0 OR invoice_type IN ('STORNO','CORRECTION'));

ALTER TABLE public.fixed_assets
  DROP CONSTRAINT IF EXISTS fixed_assets_residual_le_acquisition;
ALTER TABLE public.fixed_assets
  ADD CONSTRAINT fixed_assets_residual_le_acquisition
  CHECK (residual_value IS NULL OR residual_value <= acquisition_value);

ALTER TABLE public.fixed_asset_depreciation_entries
  DROP CONSTRAINT IF EXISTS fixed_asset_depreciation_period_month_start;
ALTER TABLE public.fixed_asset_depreciation_entries
  ADD CONSTRAINT fixed_asset_depreciation_period_month_start
  CHECK (period = date_trunc('month', period::timestamp)::date);

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
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid;
    v_line record;
    v_received_invoice record;
    v_fixed_asset_id uuid;
    v_acquisition_value numeric;
    v_currency text;
    v_vat_status text;
    v_put_into_use_date date;
    v_legal_start_date date;
    v_start_date date;
    v_monthly numeric := 0;
    v_deg_coeff numeric := 1.5;
BEGIN
    v_user_id := public.get_auth_user_id();

    SELECT * INTO v_line
    FROM public.received_invoice_lines
    WHERE id = p_received_invoice_line_id
    FOR UPDATE;

    IF v_line IS NULL THEN
        RAISE EXCEPTION 'Linie factură nu există';
    END IF;

    SELECT * INTO v_received_invoice
    FROM public.received_invoices
    WHERE id = v_line.received_invoice_id
    FOR UPDATE;

    IF v_received_invoice IS NULL OR v_received_invoice.owner_user_id <> v_user_id THEN
        RAISE EXCEPTION 'Factură primită nu există sau acces interzis';
    END IF;

    IF v_line.treatment <> 'mijloc_fix' THEN
        RAISE EXCEPTION 'Linia nu este clasificată ca mijloc fix';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.fixed_assets
        WHERE source_invoice_line_id = p_received_invoice_line_id
    ) THEN
        RAISE EXCEPTION 'Există deja un mijloc fix pentru această linie';
    END IF;

    SELECT ps.vat_status INTO v_vat_status
    FROM public.pfa_settings ps
    WHERE ps.owner_user_id = v_user_id;

    -- Pentru un neplătitor de TVA, TVA nerecuperabilă intră în costul de achiziție.
    -- Pentru un plătitor de TVA, folosim baza netă (cazul uzual de TVA recuperabilă).
    v_acquisition_value := CASE
        WHEN COALESCE(v_vat_status, 'neinregistrat') = 'neinregistrat'
            THEN COALESCE(v_line.total_amount, 0)
        ELSE COALESCE(v_line.net_amount, 0)
    END;
    v_currency := v_received_invoice.currency;

    IF v_acquisition_value <= 0 THEN
        RAISE EXCEPTION 'Valoare linie invalidă';
    END IF;

    IF p_depreciation_method NOT IN ('LINEAR','DEGRESSIVE','NONE') THEN
        RAISE EXCEPTION 'Metodă de amortizare invalidă';
    END IF;

    IF p_depreciation_method <> 'NONE' AND (p_useful_life_months IS NULL OR p_useful_life_months <= 0) THEN
        RAISE EXCEPTION 'Durata de utilizare trebuie să fie pozitivă';
    END IF;

    v_put_into_use_date := COALESCE(p_commissioning_date, p_entry_date, v_received_invoice.document_date);
    v_legal_start_date := (date_trunc('month', v_put_into_use_date::timestamp)::date + interval '1 month')::date;
    v_start_date := CASE
        WHEN p_depreciation_method = 'NONE' THEN NULL
        WHEN p_depreciation_start_date IS NULL THEN v_legal_start_date
        ELSE GREATEST(date_trunc('month', p_depreciation_start_date::timestamp)::date, v_legal_start_date)
    END;

    IF p_depreciation_method = 'LINEAR' THEN
        v_monthly := ROUND(v_acquisition_value / p_useful_life_months, 2);
    ELSIF p_depreciation_method = 'DEGRESSIVE' THEN
        v_deg_coeff := CASE
            WHEN p_useful_life_months <= 60 THEN 1.5
            WHEN p_useful_life_months <= 120 THEN 2.0
            ELSE 2.5
        END;
        v_monthly := ROUND(v_acquisition_value * v_deg_coeff / p_useful_life_months, 2);
    END IF;

    INSERT INTO public.fixed_assets (
        owner_user_id,
        source_invoice_id,
        source_invoice_line_id,
        supplier_id,
        name,
        document_reference,
        asset_category,
        classification_code,
        serial_number,
        acquisition_date,
        entry_date,
        commissioning_date,
        put_into_use_date,
        acquisition_value,
        residual_value,
        currency,
        exchange_rate,
        depreciation_method,
        useful_life,
        depreciation_start_date,
        monthly_depreciation,
        accumulated_depreciation,
        remaining_value,
        net_book_value,
        status,
        location,
        responsible_person,
        notes
    ) VALUES (
        v_user_id,
        v_received_invoice.id,
        p_received_invoice_line_id,
        v_received_invoice.supplier_id,
        p_name,
        'Factura ' || COALESCE(v_received_invoice.series || '-', '') || v_received_invoice.number,
        p_asset_category,
        p_classification_code,
        p_serial_number,
        v_received_invoice.document_date,
        COALESCE(p_entry_date, v_received_invoice.document_date),
        p_commissioning_date,
        v_put_into_use_date,
        v_acquisition_value,
        0,
        v_currency,
        1.0,
        p_depreciation_method,
        p_useful_life_months,
        v_start_date,
        v_monthly,
        0,
        v_acquisition_value,
        v_acquisition_value,
        CASE WHEN p_depreciation_method = 'NONE' THEN 'in_service' ELSE 'depreciating' END,
        p_location,
        p_responsible_person,
        p_notes
    )
    RETURNING id INTO v_fixed_asset_id;

    PERFORM public.generate_inventory_number(v_fixed_asset_id);
    PERFORM public.write_audit_log(
        'fixed_asset_created', 'fixed_asset', v_fixed_asset_id,
        jsonb_build_object(
            'invoice_line_id', p_received_invoice_line_id,
            'acquisition_value', v_acquisition_value,
            'vat_status', v_vat_status,
            'depreciation_start_date', v_start_date
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'fixed_asset_id', v_fixed_asset_id,
        'acquisition_value', v_acquisition_value,
        'monthly_depreciation', v_monthly,
        'depreciation_start_date', v_start_date
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_depreciation_schedule(
    p_fixed_asset_id uuid,
    p_version integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_asset public.fixed_assets%ROWTYPE;
    v_total_periods integer;
    v_monthly_depreciation numeric(14,2);
    v_depreciable_remaining numeric(14,2);
    v_coeff numeric := 1;
BEGIN
    SELECT * INTO v_asset
    FROM public.fixed_assets
    WHERE id = p_fixed_asset_id
      AND owner_user_id = auth.uid();

    IF v_asset IS NULL THEN
        RAISE EXCEPTION 'Activ negăsit';
    END IF;
    IF v_asset.acquisition_value IS NULL OR v_asset.acquisition_value <= 0 THEN
        RAISE EXCEPTION 'Valoarea de achiziție este invalidă';
    END IF;
    IF v_asset.useful_life IS NULL OR v_asset.useful_life <= 0 THEN
        RAISE EXCEPTION 'Durata de viață este invalidă';
    END IF;
    IF v_asset.depreciation_method = 'NONE' THEN
        RAISE EXCEPTION 'Activul nu are amortizare configurată';
    END IF;

    v_total_periods := v_asset.useful_life;
    v_depreciable_remaining := GREATEST(
        COALESCE(v_asset.remaining_value, v_asset.acquisition_value) - COALESCE(v_asset.residual_value,0),
        0
    );

    IF v_asset.depreciation_method = 'LINEAR' THEN
        v_monthly_depreciation := ROUND(
            (v_asset.acquisition_value - COALESCE(v_asset.residual_value,0)) / v_asset.useful_life,
            2
        );
    ELSIF v_asset.depreciation_method = 'DEGRESSIVE' THEN
        v_coeff := CASE
            WHEN v_asset.useful_life <= 60 THEN 1.5
            WHEN v_asset.useful_life <= 120 THEN 2.0
            ELSE 2.5
        END;
        v_monthly_depreciation := LEAST(
            ROUND(v_depreciable_remaining * v_coeff / v_asset.useful_life, 2),
            v_depreciable_remaining
        );
    ELSE
        RAISE EXCEPTION 'Metoda de amortizare nu este suportată';
    END IF;

    RETURN jsonb_build_object(
        'total_periods', v_total_periods,
        'monthly_depreciation', v_monthly_depreciation,
        'depreciation_method', v_asset.depreciation_method,
        'degressive_coefficient', CASE WHEN v_asset.depreciation_method='DEGRESSIVE' THEN v_coeff ELSE NULL END,
        'depreciation_start_date', v_asset.depreciation_start_date,
        'depreciable_remaining', v_depreciable_remaining
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_depreciation_entry(
    p_fixed_asset_id uuid,
    p_period date,
    p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid;
    v_asset record;
    v_entry_id uuid;
    v_new_accumulated numeric;
    v_new_remaining numeric;
    v_residual numeric;
    v_max_accumulated numeric;
    v_period date;
    v_start_month date;
    v_amount numeric;
BEGIN
    v_user_id := public.get_auth_user_id();

    SELECT * INTO v_asset
    FROM public.fixed_assets
    WHERE id = p_fixed_asset_id AND owner_user_id = v_user_id
    FOR UPDATE;

    IF v_asset IS NULL THEN
        RAISE EXCEPTION 'Mijloc fix nu există';
    END IF;
    IF v_asset.depreciation_method = 'NONE' THEN
        RAISE EXCEPTION 'Activul nu este amortizabil';
    END IF;

    v_period := date_trunc('month', p_period::timestamp)::date;
    v_amount := ROUND(p_amount, 2);
    v_residual := COALESCE(v_asset.residual_value, 0);
    v_max_accumulated := v_asset.acquisition_value - v_residual;
    v_start_month := COALESCE(
        date_trunc('month', v_asset.depreciation_start_date::timestamp)::date,
        (date_trunc('month', COALESCE(v_asset.commissioning_date, v_asset.put_into_use_date, v_asset.acquisition_date)::timestamp)::date + interval '1 month')::date
    );

    IF v_period < v_start_month THEN
        RAISE EXCEPTION 'Amortizarea poate începe cel mai devreme în luna %', v_start_month;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.fixed_asset_depreciation_entries
        WHERE fixed_asset_id = p_fixed_asset_id AND period = v_period
    ) THEN
        RAISE EXCEPTION 'Există deja amortizare înregistrată pentru această perioadă';
    END IF;

    IF v_amount <= 0 THEN
        RAISE EXCEPTION 'Suma trebuie să fie pozitivă';
    END IF;

    v_new_accumulated := COALESCE(v_asset.accumulated_depreciation, 0) + v_amount;
    IF v_new_accumulated > v_max_accumulated THEN
        RAISE EXCEPTION 'Amortizarea depășește baza amortizabilă rămasă (%)',
            v_max_accumulated - COALESCE(v_asset.accumulated_depreciation,0);
    END IF;

    v_new_remaining := v_asset.acquisition_value - v_new_accumulated;

    INSERT INTO public.fixed_asset_depreciation_entries (
        owner_user_id, fixed_asset_id, period, amount,
        cumulative_amount, remaining_value, created_by
    ) VALUES (
        v_user_id, p_fixed_asset_id, v_period, v_amount,
        v_new_accumulated, v_new_remaining, v_user_id
    ) RETURNING id INTO v_entry_id;

    UPDATE public.fixed_assets
    SET accumulated_depreciation = v_new_accumulated,
        remaining_value = v_new_remaining,
        net_book_value = v_new_remaining,
        status = CASE
            WHEN v_new_remaining <= v_residual THEN 'fully_depreciated'
            ELSE 'depreciating'
        END,
        updated_at = now()
    WHERE id = p_fixed_asset_id;

    PERFORM public.write_audit_log(
        'depreciation_entry_created', 'fixed_asset', p_fixed_asset_id,
        jsonb_build_object('period', v_period, 'amount', v_amount)
    );

    RETURN jsonb_build_object(
        'success', true,
        'entry_id', v_entry_id,
        'accumulated', v_new_accumulated,
        'remaining', v_new_remaining,
        'residual_value', v_residual
    );
END;
$$;

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
    v_refund_amount numeric;
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
    IF v_original.document_status NOT IN ('ISSUED', 'CORRECTED') THEN
        RAISE EXCEPTION 'Factura originală nu este emisă';
    END IF;
    IF p_storno_type NOT IN ('CORRECTION', 'STORNO') THEN
        RAISE EXCEPTION 'Tip document corectiv invalid';
    END IF;

    v_total := -v_original.total;
    v_refund_amount := COALESCE(v_original.paid_total, 0);

    INSERT INTO public.invoices (
        owner_user_id, series_id, series, number, issue_date, due_date,
        invoice_type, document_status, payment_status, xml_status, efactura_status,
        client_id, currency, subtotal, discount_total, taxable_base, vat_total, total,
        paid_total, balance_due, notes, payment_terms, corrects_invoice_id, created_by
    ) VALUES (
        v_user_id, NULL, NULL, NULL, CURRENT_DATE, CURRENT_DATE,
        p_storno_type, 'DRAFT', 'PAID', 'NOT_GENERATED', 'NOT_SUBMITTED',
        v_original.client_id, v_original.currency,
        -v_original.subtotal, -v_original.discount_total,
        -v_original.taxable_base, -v_original.vat_total, v_total,
        v_total, 0,
        COALESCE('Storno factură ' || v_original.series || '-' || v_original.number, 'Storno'),
        v_original.payment_terms, p_original_invoice_id, v_user_id
    ) RETURNING id INTO v_invoice_id;

    INSERT INTO public.invoice_lines (
        invoice_id, position, description, quantity, unit, unit_price,
        discount, vat_rate, vat_category, net_amount, vat_amount, total_amount
    )
    SELECT
        v_invoice_id, position, description, -quantity, unit, unit_price,
        -discount, vat_rate, vat_category, -net_amount, -vat_amount, -total_amount
    FROM public.invoice_lines
    WHERE invoice_id = p_original_invoice_id
    ORDER BY position;

    UPDATE public.invoices
    SET corrected_by_invoice_id = v_invoice_id,
        document_status = CASE WHEN p_storno_type = 'STORNO' THEN 'STORNED' ELSE 'CORRECTED' END,
        updated_at = now()
    WHERE id = p_original_invoice_id;

    IF v_refund_amount > 0 THEN
        INSERT INTO public.financial_transactions (
            owner_user_id, transaction_date, direction, transaction_type,
            amount, currency, payment_method, bank_account_id, description,
            counterparty_name, reference, status, created_by
        ) VALUES (
            v_user_id, CURRENT_DATE, 'OUT', 'REFUND_OUT',
            v_refund_amount, v_original.currency, 'BANK', NULL,
            'Returnare sumă factură ' || v_original.series || '-' || v_original.number || ' (storno)',
            (SELECT legal_name FROM public.clients WHERE id = v_original.client_id),
            'REF-' || v_original.series || '-' || v_original.number,
            'CONFIRMED', v_user_id
        );
    END IF;

    PERFORM public.write_audit_log(
        'storno_created', 'invoice', v_invoice_id,
        jsonb_build_object(
            'original_invoice_id', p_original_invoice_id,
            'type', p_storno_type,
            'refund_amount', v_refund_amount
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'invoice_id', v_invoice_id,
        'original_invoice_id', p_original_invoice_id
    );
END;
$$;
