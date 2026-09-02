-- Prevent account deletion or direct file operations from destroying accounting history.
begin;

do $$
declare fk record;
begin
  for fk in
    select n.nspname schema_name, c.relname table_name, co.conname
    from pg_constraint co
    join pg_class c on c.oid = co.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where co.contype = 'f'
      and n.nspname = 'public'
      and co.confrelid = 'auth.users'::regclass
      and co.confdeltype = 'c'
      and pg_get_constraintdef(co.oid) ilike 'FOREIGN KEY (owner_user_id)%'
  loop
    execute format('alter table %I.%I drop constraint %I', fk.schema_name, fk.table_name, fk.conname);
    execute format(
      'alter table %I.%I add constraint %I foreign key (owner_user_id) references auth.users(id) on delete restrict',
      fk.schema_name, fk.table_name, fk.conname
    );
  end loop;
end $$;

alter table public.documents
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists archive_reason text;

create index if not exists documents_owner_archived_at_idx
  on public.documents(owner_user_id, archived_at);

drop policy if exists documents_insert_own on public.documents;
create policy documents_insert_own on public.documents
  for insert to authenticated
  with check (owner_user_id = (select auth.uid()) and archived_at is null);

drop policy if exists documents_select_own on public.documents;
create policy documents_select_own on public.documents
  for select to authenticated
  using (owner_user_id = (select auth.uid()));

drop policy if exists documents_update_own on public.documents;
drop policy if exists documents_delete_own on public.documents;
revoke update, delete, truncate, references, trigger on public.documents from authenticated;

create or replace function public.archive_unlinked_document(
  p_document_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  u uuid := public.get_auth_user_id();
  d public.documents%rowtype;
begin
  select * into d
  from public.documents
  where id = p_document_id and owner_user_id = u
  for update;

  if d.id is null then raise exception 'Documentul nu există sau accesul este interzis'; end if;
  if d.archived_at is not null then
    return jsonb_build_object('success', true, 'document_id', d.id, 'archived', true, 'reused', true);
  end if;
  if exists (select 1 from public.document_links l where l.document_id = d.id) then
    raise exception 'Un document justificativ asociat unei înregistrări nu poate fi arhivat';
  end if;

  update public.documents
  set archived_at = now(), archived_by = u, archive_reason = nullif(btrim(p_reason), '')
  where id = d.id;

  perform public.write_audit_log(
    'document_archived', 'document', d.id,
    jsonb_build_object('storage_path', d.storage_path, 'reason', nullif(btrim(p_reason), ''))
  );

  return jsonb_build_object('success', true, 'document_id', d.id, 'archived', true);
end $$;

revoke execute on function public.archive_unlinked_document(uuid,text) from public, anon;
grant execute on function public.archive_unlinked_document(uuid,text) to authenticated, service_role;

-- Stored accounting evidence is append-only for authenticated clients.
drop policy if exists storage_insert_own_documents on storage.objects;
create policy storage_insert_own_documents on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists storage_read_own_documents on storage.objects;
create policy storage_read_own_documents on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists storage_update_own_documents on storage.objects;
drop policy if exists storage_delete_own_documents on storage.objects;

commit;

