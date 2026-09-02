-- Make public-schema RLS explicit and cache auth.uid() once per statement.
-- Add covering indexes for every foreign key that does not already have one.
begin;

do $$
declare
  pol record;
  statement text;
  using_expression text;
  check_expression text;
begin
  for pol in
    select p.polname, n.nspname schema_name, c.relname table_name,
      pg_get_expr(p.polqual,p.polrelid) using_expression,
      pg_get_expr(p.polwithcheck,p.polrelid) check_expression
    from pg_policy p
    join pg_class c on c.oid=p.polrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and p.polroles='{0}'::oid[]
  loop
    using_expression := replace(pol.using_expression, 'auth.uid()', '(select auth.uid())');
    check_expression := replace(pol.check_expression, 'auth.uid()', '(select auth.uid())');
    statement := format('alter policy %I on %I.%I to authenticated', pol.polname, pol.schema_name, pol.table_name);
    if using_expression is not null then statement := statement || ' using (' || using_expression || ')'; end if;
    if check_expression is not null then statement := statement || ' with check (' || check_expression || ')'; end if;
    execute statement;
  end loop;
end $$;

-- These records are posted through audited SECURITY DEFINER RPCs; clients only read them.
drop policy if exists fixed_asset_entries_owner on public.fixed_asset_depreciation_entries;
drop policy if exists fixed_asset_entries_insert on public.fixed_asset_depreciation_entries;
drop policy if exists fixed_asset_entries_delete on public.fixed_asset_depreciation_entries;
drop policy if exists fixed_asset_entries_update on public.fixed_asset_depreciation_entries;
revoke insert, update, delete, truncate, references, trigger
  on public.fixed_asset_depreciation_entries from authenticated;

drop policy if exists inventory_numbers_owner on public.inventory_numbers;
drop policy if exists inventory_numbers_insert on public.inventory_numbers;
drop policy if exists inventory_numbers_delete on public.inventory_numbers;
drop policy if exists inventory_numbers_update on public.inventory_numbers;
revoke insert, update, delete, truncate, references, trigger
  on public.inventory_numbers from authenticated;

do $$
declare
  fk record;
  index_name text;
begin
  for fk in
    select
      ns.nspname schema_name,
      tbl.relname table_name,
      con.conname constraint_name,
      string_agg(quote_ident(att.attname), ', ' order by key_position.ordinality) columns_sql
    from pg_constraint con
    join pg_class tbl on tbl.oid=con.conrelid
    join pg_namespace ns on ns.oid=tbl.relnamespace
    join lateral unnest(con.conkey) with ordinality key_position(attnum, ordinality) on true
    join pg_attribute att on att.attrelid=con.conrelid and att.attnum=key_position.attnum
    where con.contype='f' and ns.nspname='public'
      and not exists (
        select 1
        from pg_index idx
        where idx.indrelid=con.conrelid
          and idx.indisvalid
          and (idx.indkey::smallint[])[0:cardinality(con.conkey)-1] @> con.conkey
      )
    group by ns.nspname,tbl.relname,con.conname
  loop
    index_name := left(fk.constraint_name || '_idx',63);
    execute format('create index if not exists %I on %I.%I (%s)',
      index_name,fk.schema_name,fk.table_name,fk.columns_sql);
  end loop;
end $$;

commit;
