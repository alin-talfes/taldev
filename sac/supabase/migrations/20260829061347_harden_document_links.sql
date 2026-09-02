-- Ensure an attachment belongs to exactly one owned entity.
begin;

alter table public.document_links
  add constraint document_links_exactly_one_entity_check check (
    num_nonnulls(invoice_id,received_invoice_id,expense_id,client_id,supplier_id,fixed_asset_id,
      inventory_item_id,transaction_id,financial_transaction_id) = 1
  );

create or replace function public.enforce_document_link_owner()
returns trigger language plpgsql security definer set search_path='' as $$
declare document_owner uuid;
begin
  select d.owner_user_id into document_owner from public.documents d where d.id=new.document_id;
  if document_owner is null then raise exception 'Document inexistent'; end if;
  if new.invoice_id is not null and not exists(select 1 from public.invoices x where x.id=new.invoice_id and x.owner_user_id=document_owner) then raise exception 'Factura nu aparține proprietarului documentului'; end if;
  if new.received_invoice_id is not null and not exists(select 1 from public.received_invoices x where x.id=new.received_invoice_id and x.owner_user_id=document_owner) then raise exception 'Factura primită nu aparține proprietarului documentului'; end if;
  if new.expense_id is not null and not exists(select 1 from public.expenses x where x.id=new.expense_id and x.owner_user_id=document_owner) then raise exception 'Cheltuiala nu aparține proprietarului documentului'; end if;
  if new.client_id is not null and not exists(select 1 from public.clients x where x.id=new.client_id and x.owner_user_id=document_owner) then raise exception 'Clientul nu aparține proprietarului documentului'; end if;
  if new.supplier_id is not null and not exists(select 1 from public.suppliers x where x.id=new.supplier_id and x.owner_user_id=document_owner) then raise exception 'Furnizorul nu aparține proprietarului documentului'; end if;
  if new.fixed_asset_id is not null and not exists(select 1 from public.fixed_assets x where x.id=new.fixed_asset_id and x.owner_user_id=document_owner) then raise exception 'Mijlocul fix nu aparține proprietarului documentului'; end if;
  if new.inventory_item_id is not null and not exists(select 1 from public.inventory_items x where x.id=new.inventory_item_id and x.owner_user_id=document_owner) then raise exception 'Elementul de inventar nu aparține proprietarului documentului'; end if;
  if new.transaction_id is not null and not exists(select 1 from public.financial_transactions x where x.id=new.transaction_id and x.owner_user_id=document_owner) then raise exception 'Tranzacția nu aparține proprietarului documentului'; end if;
  if new.financial_transaction_id is not null and not exists(select 1 from public.financial_transactions x where x.id=new.financial_transaction_id and x.owner_user_id=document_owner) then raise exception 'Tranzacția financiară nu aparține proprietarului documentului'; end if;
  return new;
end $$;

drop trigger if exists document_links_owner_guard on public.document_links;
create trigger document_links_owner_guard before insert or update on public.document_links
for each row execute function public.enforce_document_link_owner();
revoke all on function public.enforce_document_link_owner() from public,anon,authenticated;

revoke update on public.document_links from authenticated;
drop policy if exists document_links_update_own on public.document_links;

commit;

