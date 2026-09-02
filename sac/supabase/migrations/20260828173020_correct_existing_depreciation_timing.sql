-- Normalizează data de punere în funcțiune și data fiscală de start.
UPDATE public.fixed_assets fa
SET put_into_use_date = COALESCE(fa.put_into_use_date,fa.commissioning_date,fa.acquisition_date),
    depreciation_start_date = CASE
      WHEN fa.depreciation_method='NONE' THEN NULL
      ELSE GREATEST(
        COALESCE(date_trunc('month',fa.depreciation_start_date::timestamp)::date,
                 (date_trunc('month',COALESCE(fa.commissioning_date,fa.put_into_use_date,fa.acquisition_date)::timestamp)::date + interval '1 month')::date),
        (date_trunc('month',COALESCE(fa.commissioning_date,fa.put_into_use_date,fa.acquisition_date)::timestamp)::date + interval '1 month')::date
      )
    END,
    monthly_depreciation = CASE
      WHEN fa.depreciation_method='LINEAR' AND fa.useful_life>0 THEN
        ROUND((fa.acquisition_value-COALESCE(fa.residual_value,0))/fa.useful_life,2)
      ELSE fa.monthly_depreciation
    END,
    updated_at=now()
WHERE fa.depreciation_method<>'NONE';

-- Șterge numai amortizările înregistrate înainte de data fiscală validă și păstrează auditul corecției.
WITH deleted AS (
  DELETE FROM public.fixed_asset_depreciation_entries de
  USING public.fixed_assets fa
  WHERE de.fixed_asset_id=fa.id
    AND fa.depreciation_method<>'NONE'
    AND fa.depreciation_start_date IS NOT NULL
    AND de.period < fa.depreciation_start_date
  RETURNING de.fixed_asset_id,de.period,de.amount
), agg AS (
  SELECT fixed_asset_id,
         SUM(amount) AS removed_amount,
         jsonb_agg(jsonb_build_object('period',period,'amount',amount) ORDER BY period) AS removed_entries
  FROM deleted
  GROUP BY fixed_asset_id
)
INSERT INTO public.audit_logs(owner_user_id,event_type,entity_type,entity_id,event_data,created_by)
SELECT fa.owner_user_id,'depreciation_timing_corrected','fixed_asset',fa.id,
       jsonb_build_object(
         'removed_amount',agg.removed_amount,
         'removed_entries',agg.removed_entries,
         'depreciation_start_date',fa.depreciation_start_date,
         'reason','Amortizarea fiscală începe din luna următoare punerii în funcțiune'
       ),
       fa.owner_user_id
FROM agg
JOIN public.fixed_assets fa ON fa.id=agg.fixed_asset_id;

-- Recalculează starea activului exclusiv din înregistrările de amortizare rămase valide.
WITH sums AS (
  SELECT fa.id,
         COALESCE(SUM(de.amount),0)::numeric AS accumulated
  FROM public.fixed_assets fa
  LEFT JOIN public.fixed_asset_depreciation_entries de ON de.fixed_asset_id=fa.id
  GROUP BY fa.id
)
UPDATE public.fixed_assets fa
SET accumulated_depreciation=s.accumulated,
    remaining_value=fa.acquisition_value-s.accumulated,
    net_book_value=fa.acquisition_value-s.accumulated,
    status=CASE
      WHEN fa.depreciation_method='NONE' THEN fa.status
      WHEN fa.acquisition_value-s.accumulated <= COALESCE(fa.residual_value,0) THEN 'fully_depreciated'
      WHEN fa.depreciation_start_date>CURRENT_DATE THEN 'in_service'
      ELSE 'depreciating'
    END,
    updated_at=now()
FROM sums s
WHERE fa.id=s.id;
