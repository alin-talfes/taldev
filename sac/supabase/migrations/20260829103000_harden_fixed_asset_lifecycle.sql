-- Preserve the accounting history of fixed assets once they enter service.
-- The application stores the fiscal acquisition value in RON; source FX data
-- remains separately available in source_currency/source_amount/exchange_rate.
begin;

alter table public.fixed_assets
  add column if not exists disposal_date date,
  add column if not exists disposal_type text,
  add column if not exists disposal_notes text;

alter table public.fixed_assets
  drop constraint if exists fixed_assets_currency_ron,
  add constraint fixed_assets_currency_ron check (currency = 'RON'),
  drop constraint if exists fixed_assets_accumulated_within_depreciable_base,
  add constraint fixed_assets_accumulated_within_depreciable_base
    check (accumulated_depreciation <= acquisition_value - coalesce(residual_value, 0)),
  drop constraint if exists fixed_assets_net_book_value_consistent,
  add constraint fixed_assets_net_book_value_consistent
    check (net_book_value is null or net_book_value = remaining_value),
  drop constraint if exists fixed_assets_useful_life_required,
  add constraint fixed_assets_useful_life_required
    check (depreciation_method = 'NONE' or useful_life > 0),
  drop constraint if exists fixed_assets_depreciation_start_legal_minimum,
  add constraint fixed_assets_depreciation_start_legal_minimum check (
    depreciation_method = 'NONE'
    or depreciation_start_date is null
    or depreciation_start_date >=
      (date_trunc('month', coalesce(commissioning_date, put_into_use_date, acquisition_date)::timestamp)::date
       + interval '1 month')::date
  ),
  drop constraint if exists fixed_assets_disposal_fields_consistent,
  add constraint fixed_assets_disposal_fields_consistent check (
    (status in ('sold', 'scrapped', 'disposed', 'SOLD', 'DISPOSED')
      and disposal_date is not null and disposal_type in ('sold', 'scrapped', 'disposed'))
    or
    (status not in ('sold', 'scrapped', 'disposed', 'SOLD', 'DISPOSED')
      and disposal_date is null and disposal_type is null)
  );

drop policy if exists fixed_assets_insert_own on public.fixed_assets;
create policy fixed_assets_insert_own on public.fixed_assets
  for insert to authenticated
  with check (owner_user_id = (select auth.uid()) and status in ('draft', 'acquired'));

drop policy if exists fixed_assets_update_own on public.fixed_assets;
create policy fixed_assets_update_pre_service_only on public.fixed_assets
  for update to authenticated
  using (owner_user_id = (select auth.uid()) and status in ('draft', 'acquired'))
  with check (
    owner_user_id = (select auth.uid())
    and status in ('draft', 'acquired', 'in_service', 'depreciating')
    and disposal_date is null and disposal_type is null
  );

drop policy if exists fixed_assets_delete_own on public.fixed_assets;
create policy fixed_assets_delete_unposted_only on public.fixed_assets
  for delete to authenticated using (
    owner_user_id = (select auth.uid())
    and status in ('draft', 'acquired')
    and source_invoice_id is null
    and not exists (
      select 1 from public.fixed_asset_depreciation_entries de
      where de.fixed_asset_id = fixed_assets.id
    )
  );

create or replace function public.dispose_fixed_asset(
  p_fixed_asset_id uuid,
  p_disposal_type text,
  p_disposal_date date,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := public.get_auth_user_id();
  v_asset public.fixed_assets%rowtype;
begin
  select * into v_asset
  from public.fixed_assets
  where id = p_fixed_asset_id and owner_user_id = v_user_id
  for update;

  if v_asset is null then raise exception 'Mijloc fix nu există'; end if;
  if v_asset.status not in ('in_service', 'depreciating', 'fully_depreciated') then
    raise exception 'Mijlocul fix nu este eligibil pentru scoatere din funcțiune';
  end if;
  if p_disposal_type not in ('sold', 'scrapped', 'disposed') then
    raise exception 'Tip scoatere invalid';
  end if;
  if p_disposal_date is null or p_disposal_date < v_asset.acquisition_date then
    raise exception 'Data scoaterii nu poate preceda data achiziției';
  end if;

  update public.fixed_assets
  set status = p_disposal_type,
      disposal_date = p_disposal_date,
      disposal_type = p_disposal_type,
      disposal_notes = p_notes,
      updated_at = now(),
      notes = concat_ws(E'\n', nullif(v_asset.notes, ''),
        'Ieșire: ' || p_disposal_type || ' la ' || p_disposal_date::text ||
        case when nullif(p_notes, '') is null then '' else ' - ' || p_notes end)
  where id = p_fixed_asset_id;

  update public.inventory_numbers
  set status = 'RETIRED', retired_at = now()
  where fixed_asset_id = p_fixed_asset_id and status = 'ACTIVE';

  update public.inventory_items
  set status = case p_disposal_type
                 when 'sold' then 'SOLD'
                 when 'scrapped' then 'WRITTEN_OFF'
                 else 'ARCHIVED'
               end,
      notes = concat_ws(E'\n', nullif(notes, ''),
        'Ieșire la ' || p_disposal_date::text ||
        case when nullif(p_notes, '') is null then '' else ' - ' || p_notes end)
  where owner_user_id = v_user_id
    and document_reference = 'Factura ' || coalesce(v_asset.source_invoice_id::text, v_asset.document_reference)
    and description = v_asset.name;

  perform public.write_audit_log(
    'fixed_asset_disposed', 'fixed_asset', p_fixed_asset_id,
    jsonb_build_object(
      'disposal_type', p_disposal_type,
      'disposal_date', p_disposal_date,
      'notes', p_notes,
      'remaining_value', v_asset.remaining_value
    )
  );

  return jsonb_build_object(
    'success', true,
    'status', p_disposal_type,
    'disposal_date', p_disposal_date
  );
end $$;

revoke execute on function public.dispose_fixed_asset(uuid,text,date,text) from public, anon;
grant execute on function public.dispose_fixed_asset(uuid,text,date,text) to authenticated, service_role;

commit;
