-- Keep the document's fiscal RON value separate from later receipt conversions.

alter table public.invoices
  add column document_exchange_rate numeric(18,6),
  add column document_exchange_rate_date date,
  add column document_exchange_rate_source text,
  add column document_total_ron numeric(18,2) generated always as (
    case
      when currency = 'RON' then total
      when document_exchange_rate is not null then round(total * document_exchange_rate, 2)
      else null
    end
  ) stored,
  add constraint invoices_document_exchange_rate_positive_check
    check (document_exchange_rate is null or document_exchange_rate > 0),
  add constraint invoices_document_fx_complete_check
    check (
      currency <> 'RON'
      or (document_exchange_rate is null and document_exchange_rate_date is null and document_exchange_rate_source is null)
    );

create or replace function public.set_issued_invoice_document_fx(
  p_invoice_id uuid,
  p_exchange_rate numeric,
  p_exchange_rate_date date,
  p_exchange_rate_source text default 'BNR'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  u uuid := public.get_auth_user_id();
  d public.invoices%rowtype;
begin
  select * into d
  from public.invoices
  where id = p_invoice_id and owner_user_id = u
  for update;

  if d.id is null then raise exception 'Factura nu există sau acces interzis'; end if;
  if d.document_status <> 'DRAFT' or d.invoice_type <> 'INVOICE' then
    raise exception 'Cursul documentului poate fi modificat numai pe factura draft';
  end if;
  if d.currency = 'RON' then raise exception 'Factura RON nu necesită curs valutar'; end if;
  if p_exchange_rate is null or p_exchange_rate <= 0 then raise exception 'Curs invalid'; end if;
  if p_exchange_rate_date is null or p_exchange_rate_date >= d.issue_date then
    raise exception 'Data cursului trebuie să fie ultima zi bancară anterioară documentului';
  end if;

  update public.invoices
  set document_exchange_rate = round(p_exchange_rate, 6),
      document_exchange_rate_date = p_exchange_rate_date,
      document_exchange_rate_source = coalesce(nullif(btrim(p_exchange_rate_source), ''), 'BNR'),
      updated_at = now()
  where id = d.id;

  perform public.write_audit_log(
    'issued_invoice_fx_set', 'invoice', d.id,
    jsonb_build_object(
      'exchange_rate', round(p_exchange_rate, 6),
      'exchange_rate_date', p_exchange_rate_date,
      'source', coalesce(nullif(btrim(p_exchange_rate_source), ''), 'BNR')
    )
  );

  return jsonb_build_object(
    'success', true,
    'invoice_id', d.id,
    'currency', d.currency,
    'exchange_rate', round(p_exchange_rate, 6)
  );
end $$;

create or replace function public.enforce_issued_invoice_document_fx()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare original public.invoices%rowtype;
begin
  if new.currency = 'RON' then
    new.document_exchange_rate := null;
    new.document_exchange_rate_date := null;
    new.document_exchange_rate_source := null;
  elsif new.invoice_type in ('STORNO', 'CORRECTION')
        and new.corrects_invoice_id is not null
        and new.document_exchange_rate is null then
    select * into original from public.invoices where id = new.corrects_invoice_id;
    new.document_exchange_rate := original.document_exchange_rate;
    new.document_exchange_rate_date := original.document_exchange_rate_date;
    new.document_exchange_rate_source := original.document_exchange_rate_source;
  end if;

  if new.document_status <> 'DRAFT' and new.currency <> 'RON' then
    if new.document_exchange_rate is null
       or new.document_exchange_rate_date is null
       or nullif(btrim(new.document_exchange_rate_source), '') is null then
      raise exception 'Factura în valută necesită cursul fiscal al documentului înainte de emitere';
    end if;
    if new.document_exchange_rate_date >= new.issue_date then
      raise exception 'Data cursului trebuie să fie ultima zi bancară anterioară documentului';
    end if;
  end if;

  return new;
end $$;

create trigger invoices_document_fx_guard
before insert or update of currency, issue_date, document_status, invoice_type, corrects_invoice_id,
  document_exchange_rate, document_exchange_rate_date, document_exchange_rate_source
on public.invoices
for each row execute function public.enforce_issued_invoice_document_fx();

revoke all on function public.set_issued_invoice_document_fx(uuid,numeric,date,text) from public, anon;
grant execute on function public.set_issued_invoice_document_fx(uuid,numeric,date,text) to authenticated;
revoke all on function public.enforce_issued_invoice_document_fx() from public, anon, authenticated;

