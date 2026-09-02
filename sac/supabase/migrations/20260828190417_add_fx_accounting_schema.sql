ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS amount_ron numeric,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric,
  ADD COLUMN IF NOT EXISTS exchange_rate_date date,
  ADD COLUMN IF NOT EXISTS bank_amount_ron numeric,
  ADD COLUMN IF NOT EXISTS fx_cash_difference_ron numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fx_fiscal_treatment text,
  ADD COLUMN IF NOT EXISTS fx_source text;

UPDATE public.financial_transactions
SET amount_ron = ROUND(amount, 2)
WHERE amount_ron IS NULL AND currency = 'RON';

ALTER TABLE public.financial_transactions
  ALTER COLUMN amount_ron SET NOT NULL;

ALTER TABLE public.financial_transactions
  DROP CONSTRAINT IF EXISTS financial_transactions_amount_ron_positive,
  ADD CONSTRAINT financial_transactions_amount_ron_positive CHECK (amount_ron > 0),
  DROP CONSTRAINT IF EXISTS financial_transactions_exchange_rate_positive,
  ADD CONSTRAINT financial_transactions_exchange_rate_positive CHECK (exchange_rate IS NULL OR exchange_rate > 0),
  DROP CONSTRAINT IF EXISTS financial_transactions_bank_amount_ron_positive,
  ADD CONSTRAINT financial_transactions_bank_amount_ron_positive CHECK (bank_amount_ron IS NULL OR bank_amount_ron > 0),
  DROP CONSTRAINT IF EXISTS financial_transactions_fx_fiscal_treatment_check,
  ADD CONSTRAINT financial_transactions_fx_fiscal_treatment_check CHECK (
    fx_fiscal_treatment IS NULL OR fx_fiscal_treatment IN ('INCOME','DEDUCTIBLE_EXPENSE','NON_DEDUCTIBLE_EXPENSE','CASH_MOVEMENT')
  );

ALTER TABLE public.transaction_allocations
  ADD COLUMN IF NOT EXISTS allocated_amount_ron numeric;

UPDATE public.transaction_allocations ta
SET allocated_amount_ron = ROUND(ta.allocated_amount, 2)
FROM public.financial_transactions ft
WHERE ft.id = ta.transaction_id
  AND ta.allocated_amount_ron IS NULL
  AND ft.currency = 'RON';

ALTER TABLE public.transaction_allocations
  ALTER COLUMN allocated_amount_ron SET NOT NULL,
  DROP CONSTRAINT IF EXISTS transaction_allocations_allocated_amount_ron_positive,
  ADD CONSTRAINT transaction_allocations_allocated_amount_ron_positive CHECK (allocated_amount_ron > 0);

ALTER TABLE public.received_invoices
  ADD COLUMN IF NOT EXISTS document_exchange_rate numeric,
  ADD COLUMN IF NOT EXISTS document_exchange_rate_date date,
  ADD COLUMN IF NOT EXISTS document_exchange_rate_source text;

ALTER TABLE public.received_invoices
  DROP CONSTRAINT IF EXISTS received_invoices_document_exchange_rate_positive,
  ADD CONSTRAINT received_invoices_document_exchange_rate_positive CHECK (document_exchange_rate IS NULL OR document_exchange_rate > 0),
  DROP CONSTRAINT IF EXISTS received_invoices_document_exchange_rate_pair,
  ADD CONSTRAINT received_invoices_document_exchange_rate_pair CHECK (
    (document_exchange_rate IS NULL AND document_exchange_rate_date IS NULL)
    OR (document_exchange_rate IS NOT NULL AND document_exchange_rate_date IS NOT NULL)
  );

ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS source_currency text,
  ADD COLUMN IF NOT EXISTS source_amount numeric,
  ADD COLUMN IF NOT EXISTS exchange_rate_date date;

UPDATE public.fixed_assets
SET source_currency = COALESCE(source_currency, currency),
    source_amount = COALESCE(source_amount, acquisition_value)
WHERE source_currency IS NULL OR source_amount IS NULL;

ALTER TABLE public.fixed_assets
  DROP CONSTRAINT IF EXISTS fixed_assets_source_amount_positive,
  ADD CONSTRAINT fixed_assets_source_amount_positive CHECK (source_amount IS NULL OR source_amount > 0),
  DROP CONSTRAINT IF EXISTS fixed_assets_source_currency_format,
  ADD CONSTRAINT fixed_assets_source_currency_format CHECK (source_currency IS NULL OR source_currency ~ '^[A-Z]{3}$');

CREATE OR REPLACE FUNCTION public.set_financial_transaction_fx_values()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_expected numeric;
BEGIN
  NEW.currency := UPPER(COALESCE(NEW.currency, 'RON'));
  NEW.amount := ROUND(NEW.amount, 2);

  IF NEW.currency = 'RON' THEN
    NEW.amount_ron := NEW.amount;
    NEW.exchange_rate := NULL;
    NEW.exchange_rate_date := NULL;
    NEW.bank_amount_ron := NULL;
    NEW.fx_cash_difference_ron := 0;
    NEW.fx_fiscal_treatment := NULL;
    NEW.fx_source := NULL;
    RETURN NEW;
  END IF;

  IF NEW.exchange_rate IS NULL OR NEW.exchange_rate <= 0 THEN
    RAISE EXCEPTION 'Operațiunea în % necesită curs BNR', NEW.currency;
  END IF;
  IF NEW.exchange_rate_date IS NULL THEN
    RAISE EXCEPTION 'Operațiunea în % necesită data cursului BNR', NEW.currency;
  END IF;
  IF NEW.transaction_date IS NULL OR NEW.exchange_rate_date >= NEW.transaction_date THEN
    RAISE EXCEPTION 'Data cursului BNR trebuie să fie o zi anterioară operațiunii';
  END IF;

  NEW.exchange_rate := ROUND(NEW.exchange_rate, 6);
  v_expected := ROUND(NEW.amount * NEW.exchange_rate, 2);
  NEW.amount_ron := v_expected;

  IF NEW.bank_amount_ron IS NOT NULL THEN
    NEW.bank_amount_ron := ROUND(NEW.bank_amount_ron, 2);
    IF NEW.direction = 'IN' THEN
      NEW.fx_cash_difference_ron := ROUND(NEW.bank_amount_ron - NEW.amount_ron, 2);
    ELSE
      NEW.fx_cash_difference_ron := ROUND(NEW.amount_ron - NEW.bank_amount_ron, 2);
    END IF;
  ELSE
    NEW.fx_cash_difference_ron := 0;
  END IF;

  IF NEW.fx_cash_difference_ron = 0 THEN
    NEW.fx_fiscal_treatment := NULL;
  ELSIF NEW.fx_cash_difference_ron > 0
        AND NEW.fx_fiscal_treatment IS NOT NULL
        AND NEW.fx_fiscal_treatment NOT IN ('INCOME','CASH_MOVEMENT') THEN
    RAISE EXCEPTION 'O diferență valutară favorabilă poate fi clasificată doar ca venit sau mișcare de numerar';
  ELSIF NEW.fx_cash_difference_ron < 0
        AND NEW.fx_fiscal_treatment IS NOT NULL
        AND NEW.fx_fiscal_treatment NOT IN ('DEDUCTIBLE_EXPENSE','NON_DEDUCTIBLE_EXPENSE','CASH_MOVEMENT') THEN
    RAISE EXCEPTION 'O diferență valutară nefavorabilă poate fi clasificată doar ca cheltuială sau mișcare de numerar';
  END IF;

  NEW.fx_source := NULLIF(BTRIM(NEW.fx_source), '');
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_set_financial_transaction_fx_values ON public.financial_transactions;
CREATE TRIGGER trg_set_financial_transaction_fx_values
BEFORE INSERT OR UPDATE OF amount, currency, transaction_date, direction, exchange_rate, exchange_rate_date, bank_amount_ron, fx_fiscal_treatment, fx_source
ON public.financial_transactions
FOR EACH ROW EXECUTE FUNCTION public.set_financial_transaction_fx_values();

CREATE OR REPLACE FUNCTION public.set_transaction_allocation_ron_value()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_currency text;
BEGIN
  SELECT ft.currency INTO v_currency
  FROM public.financial_transactions ft
  WHERE ft.id = NEW.transaction_id;

  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'Tranzacția alocată nu există';
  END IF;

  IF v_currency = 'RON' THEN
    NEW.allocated_amount_ron := ROUND(NEW.allocated_amount, 2);
  ELSIF NEW.allocated_amount_ron IS NULL OR NEW.allocated_amount_ron <= 0 THEN
    RAISE EXCEPTION 'Alocarea unei tranzacții în valută necesită echivalentul în RON';
  ELSE
    NEW.allocated_amount_ron := ROUND(NEW.allocated_amount_ron, 2);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_00_set_transaction_allocation_ron_value ON public.transaction_allocations;
CREATE TRIGGER trg_00_set_transaction_allocation_ron_value
BEFORE INSERT OR UPDATE OF transaction_id, allocated_amount, allocated_amount_ron
ON public.transaction_allocations
FOR EACH ROW EXECUTE FUNCTION public.set_transaction_allocation_ron_value();
