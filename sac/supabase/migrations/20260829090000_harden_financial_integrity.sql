-- Audit TALDEV-PFA 2026-08-29
-- Harden immutability, correction atomicity, monetary constraints and mixed-currency reports.

begin;

-- ---------------------------------------------------------------------------
-- Constraints and indexes (existing rows were checked before this migration).
-- ---------------------------------------------------------------------------
alter table public.invoices
  add constraint invoices_currency_iso4217_check check (currency ~ '^[A-Z]{3}$');
alter table public.received_invoices
  add constraint received_invoices_currency_iso4217_check check (currency ~ '^[A-Z]{3}$'),
  add constraint received_invoices_normal_amounts_check check (
    invoice_type <> 'NORMAL' or (total >= 0 and paid_total <= total and balance_due >= 0)
  );
alter table public.proformas
  add constraint proformas_currency_iso4217_check check (currency ~ '^[A-Z]{3}$');
alter table public.invoice_lines
  add constraint invoice_lines_quantity_nonzero_check check (quantity <> 0),
  add constraint invoice_lines_unit_price_nonnegative_check check (unit_price >= 0);
alter table public.received_invoice_lines
  add constraint received_invoice_lines_quantity_nonzero_check check (quantity <> 0),
  add constraint received_invoice_lines_unit_price_nonnegative_check check (unit_price >= 0);
alter table public.proforma_lines
  add constraint proforma_lines_quantity_positive_check check (quantity > 0),
  add constraint proforma_lines_discount_lte_gross_check check (discount <= round(quantity * unit_price, 2));

create unique index invoices_one_correction_per_document_idx
  on public.invoices(owner_user_id, corrects_invoice_id)
  where corrects_invoice_id is not null;
create unique index received_invoices_one_storno_per_document_idx
  on public.received_invoices(owner_user_id, storno_for_invoice_id)
  where storno_for_invoice_id is not null;
create unique index transaction_allocations_one_invoice_idx
  on public.transaction_allocations(transaction_id, invoice_id)
  where invoice_id is not null;
create unique index transaction_allocations_one_received_invoice_idx
  on public.transaction_allocations(transaction_id, received_invoice_id)
  where received_invoice_id is not null;

create index if not exists financial_transactions_bank_account_id_idx on public.financial_transactions(bank_account_id);
create index if not exists invoices_corrects_invoice_id_idx on public.invoices(corrects_invoice_id);
create index if not exists invoices_corrected_by_invoice_id_idx on public.invoices(corrected_by_invoice_id);
create index if not exists invoices_series_id_idx on public.invoices(series_id);
create index if not exists invoices_proforma_id_idx on public.invoices(proforma_id);
create index if not exists received_invoices_storno_for_invoice_id_idx on public.received_invoices(storno_for_invoice_id);
create index if not exists proformas_converted_invoice_id_idx on public.proformas(converted_invoice_id);
create index if not exists fixed_assets_source_invoice_id_idx on public.fixed_assets(source_invoice_id);
create index if not exists fixed_assets_source_invoice_line_id_idx on public.fixed_assets(source_invoice_line_id);
create index if not exists fixed_assets_supplier_id_idx on public.fixed_assets(supplier_id);
create index if not exists expenses_received_invoice_id_idx on public.expenses(received_invoice_id);
create index if not exists expenses_payment_transaction_id_idx on public.expenses(payment_transaction_id);

create or replace function public.enforce_bank_account_owner()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.bank_account_id is not null and not exists (
    select 1 from public.bank_accounts b where b.id=new.bank_account_id and b.owner_user_id=new.owner_user_id
  ) then
    raise exception 'Contul bancar nu aparține utilizatorului tranzacției';
  end if;
  return new;
end $$;
drop trigger if exists financial_transactions_bank_owner_guard on public.financial_transactions;
create trigger financial_transactions_bank_owner_guard
before insert or update of bank_account_id,owner_user_id on public.financial_transactions
for each row execute function public.enforce_bank_account_owner();
revoke all on function public.enforce_bank_account_owner() from public,anon,authenticated;

-- ---------------------------------------------------------------------------
-- RLS: only drafts may be edited; confirmed accounting history is immutable.
-- ---------------------------------------------------------------------------
drop policy if exists received_invoices_update_own on public.received_invoices;
create policy received_invoices_update_own_draft on public.received_invoices
  for update to authenticated
  using (owner_user_id = (select auth.uid()) and document_status = 'DRAFT' and invoice_type = 'NORMAL')
  with check (owner_user_id = (select auth.uid()) and document_status = 'DRAFT' and invoice_type = 'NORMAL');
drop policy if exists received_invoices_delete_own_no_payments on public.received_invoices;
create policy received_invoices_delete_own_draft on public.received_invoices
  for delete to authenticated
  using (owner_user_id = (select auth.uid()) and document_status = 'DRAFT' and invoice_type = 'NORMAL');

drop policy if exists received_invoice_lines_insert_own on public.received_invoice_lines;
create policy received_invoice_lines_insert_own_draft on public.received_invoice_lines
  for insert to authenticated with check (exists (
    select 1 from public.received_invoices ri
    where ri.id = received_invoice_id and ri.owner_user_id = (select auth.uid())
      and ri.document_status = 'DRAFT' and ri.invoice_type = 'NORMAL'
  ));
drop policy if exists received_invoice_lines_update_own on public.received_invoice_lines;
create policy received_invoice_lines_update_own_draft on public.received_invoice_lines
  for update to authenticated
  using (exists (select 1 from public.received_invoices ri where ri.id=received_invoice_id and ri.owner_user_id=(select auth.uid()) and ri.document_status='DRAFT' and ri.invoice_type='NORMAL'))
  with check (exists (select 1 from public.received_invoices ri where ri.id=received_invoice_id and ri.owner_user_id=(select auth.uid()) and ri.document_status='DRAFT' and ri.invoice_type='NORMAL'));

drop policy if exists proformas_update_own on public.proformas;
create policy proformas_update_own_draft on public.proformas
  for update to authenticated
  using (owner_user_id=(select auth.uid()) and document_status='DRAFT')
  with check (owner_user_id=(select auth.uid()) and document_status='DRAFT');
drop policy if exists proforma_lines_insert_own on public.proforma_lines;
create policy proforma_lines_insert_own_draft on public.proforma_lines
  for insert to authenticated with check (exists (select 1 from public.proformas p where p.id=proforma_id and p.owner_user_id=(select auth.uid()) and p.document_status='DRAFT'));
drop policy if exists proforma_lines_update_own on public.proforma_lines;
create policy proforma_lines_update_own_draft on public.proforma_lines
  for update to authenticated
  using (exists (select 1 from public.proformas p where p.id=proforma_id and p.owner_user_id=(select auth.uid()) and p.document_status='DRAFT'))
  with check (exists (select 1 from public.proformas p where p.id=proforma_id and p.owner_user_id=(select auth.uid()) and p.document_status='DRAFT'));

drop policy if exists invoices_update_draft_only on public.invoices;
create policy invoices_update_normal_draft_only on public.invoices
  for update to authenticated
  using (owner_user_id=(select auth.uid()) and document_status='DRAFT' and invoice_type='NORMAL')
  with check (owner_user_id=(select auth.uid()) and document_status='DRAFT' and invoice_type='NORMAL');
drop policy if exists invoice_lines_insert_draft_only on public.invoice_lines;
create policy invoice_lines_insert_normal_draft_only on public.invoice_lines
  for insert to authenticated with check (exists (
    select 1 from public.invoices i where i.id=invoice_id and i.owner_user_id=(select auth.uid())
      and i.document_status='DRAFT' and i.invoice_type='NORMAL'
  ));
drop policy if exists invoice_lines_update_draft_only on public.invoice_lines;
create policy invoice_lines_update_normal_draft_only on public.invoice_lines
  for update to authenticated
  using (exists (select 1 from public.invoices i where i.id=invoice_id and i.owner_user_id=(select auth.uid()) and i.document_status='DRAFT' and i.invoice_type='NORMAL'))
  with check (exists (select 1 from public.invoices i where i.id=invoice_id and i.owner_user_id=(select auth.uid()) and i.document_status='DRAFT' and i.invoice_type='NORMAL'));

-- Financial rows are created/changed by atomic SECURITY DEFINER RPCs only.
revoke insert, update on public.financial_transactions from authenticated;
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- ---------------------------------------------------------------------------
-- Issued-invoice corrections: the original changes state only when the
-- corrective document is successfully issued, in the same transaction.
-- ---------------------------------------------------------------------------
create or replace function public.create_storno_invoice(
  p_original_invoice_id uuid,
  p_storno_type text default 'STORNO'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.get_auth_user_id(); original record; correction_id uuid; correction_total numeric;
begin
  select * into original from public.invoices where id=p_original_invoice_id for update;
  if original is null or original.owner_user_id<>u then raise exception 'Factura originală nu există sau acces interzis'; end if;
  if original.document_status<>'ISSUED' then raise exception 'Doar o factură emisă și necorectată poate fi stornată'; end if;
  if original.invoice_type not in ('NORMAL','CORRECTION') then raise exception 'Tipul facturii originale nu poate fi corectat'; end if;
  if p_storno_type not in ('CORRECTION','STORNO') then raise exception 'Tip document corectiv invalid'; end if;
  if exists(select 1 from public.invoices where owner_user_id=u and corrects_invoice_id=p_original_invoice_id) then
    raise exception 'Există deja un document corectiv pentru această factură';
  end if;

  correction_total := -original.total;
  insert into public.invoices(owner_user_id,series_id,series,number,issue_date,due_date,invoice_type,document_status,
    payment_status,xml_status,efactura_status,client_id,currency,subtotal,discount_total,taxable_base,vat_total,total,
    paid_total,balance_due,notes,payment_terms,corrects_invoice_id,created_by)
  values(u,null,null,null,current_date,current_date,p_storno_type,'DRAFT','PAID','NOT_GENERATED','NOT_SUBMITTED',
    original.client_id,original.currency,-original.subtotal,-original.discount_total,-original.taxable_base,-original.vat_total,
    correction_total,correction_total,0,coalesce('Storno factură '||original.series||'-'||original.number,'Storno'),
    original.payment_terms,p_original_invoice_id,u) returning id into correction_id;

  insert into public.invoice_lines(invoice_id,position,description,quantity,unit,unit_price,discount,vat_rate,vat_category,net_amount,vat_amount,total_amount)
  select correction_id,position,description,-quantity,unit,unit_price,-discount,vat_rate,vat_category,-net_amount,-vat_amount,-total_amount
  from public.invoice_lines where invoice_id=p_original_invoice_id order by position;

  perform public.write_audit_log('storno_draft_created','invoice',correction_id,
    jsonb_build_object('original_invoice_id',p_original_invoice_id,'type',p_storno_type));
  return jsonb_build_object('success',true,'invoice_id',correction_id,'original_invoice_id',p_original_invoice_id,
    'refund_due',coalesce(original.paid_total,0),'original_status_changed',false);
end $$;

create or replace function public.issue_invoice(p_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.get_auth_user_id(); inv record; original record;
  v_series_id uuid; v_series_name text; v_series_year integer; v_next_no bigint;
  gross numeric; discounts numeric; taxable numeric; vat numeric; total_value numeric; line_count integer; vat_status text;
begin
  select * into inv from public.invoices where id=p_invoice_id for update;
  if inv is null or inv.owner_user_id<>u then raise exception 'Factura nu există sau acces interzis'; end if;
  if inv.document_status<>'DRAFT' then raise exception 'Factura a fost deja emisă'; end if;
  if inv.client_id is null or not exists(select 1 from public.clients where id=inv.client_id and owner_user_id=u) then raise exception 'Client lipsă sau invalid'; end if;
  if inv.issue_date is null or inv.due_date is null or inv.due_date<inv.issue_date then raise exception 'Datele facturii sunt invalide'; end if;
  if inv.currency !~ '^[A-Z]{3}$' then raise exception 'Monedă invalidă'; end if;

  if inv.invoice_type='NORMAL' and exists(select 1 from public.invoice_lines where invoice_id=p_invoice_id and
      (quantity<=0 or unit_price<0 or discount<0 or discount>round(quantity*unit_price,2) or net_amount<0 or vat_amount<0 or total_amount<0)) then
    raise exception 'Factura conține linii cu valori sau discount invalide';
  end if;
  if inv.invoice_type in ('STORNO','CORRECTION') and exists(select 1 from public.invoice_lines where invoice_id=p_invoice_id and
      (quantity>=0 or unit_price<0 or discount>0 or net_amount>0 or vat_amount>0 or total_amount>0)) then
    raise exception 'Documentul corectiv conține linii cu semne invalide';
  end if;

  select count(*),round(coalesce(sum(round(quantity*unit_price,2)),0),2),round(coalesce(sum(discount),0),2),
         round(coalesce(sum(net_amount),0),2),round(coalesce(sum(vat_amount),0),2),round(coalesce(sum(total_amount),0),2)
  into line_count,gross,discounts,taxable,vat,total_value from public.invoice_lines where invoice_id=p_invoice_id;
  if line_count=0 then raise exception 'Factura nu are linii'; end if;
  if inv.subtotal is distinct from gross or inv.discount_total is distinct from discounts or inv.taxable_base is distinct from taxable
     or inv.vat_total is distinct from vat or inv.total is distinct from total_value then raise exception 'Totalurile facturii nu corespund liniilor'; end if;
  if total_value=0 or (total_value<0 and inv.invoice_type not in ('STORNO','CORRECTION')) then raise exception 'Total invalid'; end if;
  select p.vat_status into vat_status from public.pfa_settings p where p.owner_user_id=u;
  if coalesce(vat_status,'neinregistrat')='neinregistrat' and vat<>0 then raise exception 'PFA neînregistrat în scopuri de TVA: factura nu poate colecta TVA'; end if;

  if inv.corrects_invoice_id is not null then
    select * into original from public.invoices where id=inv.corrects_invoice_id and owner_user_id=u for update;
    if original is null or original.document_status<>'ISSUED' then raise exception 'Factura originală nu mai este eligibilă pentru corecție'; end if;
  end if;

  select s.id,s.series,s.year,s.next_number into v_series_id,v_series_name,v_series_year,v_next_no
  from public.invoice_series s where s.owner_user_id=u and s.active=true and s.year=extract(year from inv.issue_date)::int
  order by s.created_at desc limit 1 for update;
  if v_series_id is null then raise exception 'Nu există serie de facturare activă pentru anul %',extract(year from inv.issue_date); end if;

  update public.invoices set series_id=v_series_id,series=v_series_name,number=v_next_no,document_status='ISSUED',issued_at=now(),updated_at=now() where id=p_invoice_id;
  update public.invoice_series set next_number=v_next_no+1,updated_at=now() where id=v_series_id;
  if inv.corrects_invoice_id is not null then
    update public.invoices set corrected_by_invoice_id=p_invoice_id,
      document_status=case when inv.invoice_type='STORNO' then 'STORNED' else 'CORRECTED' end,updated_at=now()
    where id=inv.corrects_invoice_id;
  end if;
  perform public.write_audit_log('invoice_issued','invoice',p_invoice_id,
    jsonb_build_object('series',v_series_name,'number',v_next_no,'corrects_invoice_id',inv.corrects_invoice_id));
  return jsonb_build_object('success',true,'invoice_id',p_invoice_id,'series',v_series_name,'number',v_next_no);
end $$;

-- ---------------------------------------------------------------------------
-- Received-document storno: serialize concurrent attempts and audit the change.
-- ---------------------------------------------------------------------------
create or replace function public.create_received_invoice_storno(
  p_original_invoice_id uuid,p_storno_series text,p_storno_number text,p_storno_date date
) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=public.get_auth_user_id(); original record; storno_id uuid;
begin
  select * into original from public.received_invoices
  where id=p_original_invoice_id and owner_user_id=u for update;
  if original is null or original.document_status<>'CONFIRMED' or original.invoice_type<>'NORMAL' then
    raise exception 'Factura originală nu există sau nu poate fi stornată';
  end if;
  if nullif(btrim(p_storno_number),'') is null or p_storno_date is null or p_storno_date<original.document_date then
    raise exception 'Numărul sau data documentului storno sunt invalide';
  end if;
  if exists(select 1 from public.received_invoices where owner_user_id=u and storno_for_invoice_id=p_original_invoice_id) then
    raise exception 'Factura are deja un storno înregistrat';
  end if;

  insert into public.received_invoices(owner_user_id,supplier_id,series,number,document_date,due_date,currency,category,
    deductible_status,notes,document_status,payment_status,subtotal,vat_total,total,paid_total,balance_due,invoice_type,
    storno_for_invoice_id,deductibility_percent,deductibility_limit,document_exchange_rate,document_exchange_rate_date,document_exchange_rate_source)
  values(u,original.supplier_id,nullif(btrim(p_storno_series),''),btrim(p_storno_number),p_storno_date,p_storno_date,
    original.currency,original.category,original.deductible_status,'Storno factura '||coalesce(original.series||'-','')||original.number,
    'CONFIRMED','UNPAID',-original.subtotal,-original.vat_total,-original.total,0,-original.total,'STORNO',p_original_invoice_id,
    original.deductibility_percent,original.deductibility_limit,original.document_exchange_rate,original.document_exchange_rate_date,
    original.document_exchange_rate_source) returning id into storno_id;

  insert into public.received_invoice_lines(received_invoice_id,position,description,quantity,unit,unit_price,discount,vat_rate,
    vat_category,net_amount,vat_amount,total_amount,treatment)
  select storno_id,position,description,-abs(quantity),unit,unit_price,-abs(discount),vat_rate,vat_category,
    -abs(net_amount),-abs(vat_amount),-abs(total_amount),treatment
  from public.received_invoice_lines where received_invoice_id=p_original_invoice_id order by position;

  update public.received_invoices set document_status='CANCELLED',updated_at=now() where id=p_original_invoice_id;
  perform public.write_audit_log('received_invoice_storno_created','received_invoice',storno_id,
    jsonb_build_object('original_invoice_id',p_original_invoice_id));
  return storno_id;
end $$;

-- ---------------------------------------------------------------------------
-- FX metadata and manual operations: immutable/auditable and explicit.
-- ---------------------------------------------------------------------------
create or replace function public.set_received_invoice_document_fx(
  p_received_invoice_id uuid,p_exchange_rate numeric,p_exchange_rate_date date,p_exchange_rate_source text default 'BNR'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.get_auth_user_id(); d public.received_invoices%rowtype;
begin
  select * into d from public.received_invoices where id=p_received_invoice_id and owner_user_id=u for update;
  if d.id is null then raise exception 'Factura primită nu există sau acces interzis'; end if;
  if d.invoice_type<>'NORMAL' or d.document_status not in ('DRAFT','RECEIVED') then raise exception 'Cursul documentului nu mai poate fi modificat după confirmare'; end if;
  if d.currency='RON' then raise exception 'Factura RON nu necesită curs valutar'; end if;
  if p_exchange_rate is null or p_exchange_rate<=0 then raise exception 'Curs invalid'; end if;
  if p_exchange_rate_date is null or p_exchange_rate_date>=d.document_date then raise exception 'Data cursului trebuie să fie ultima zi bancară anterioară documentului'; end if;
  update public.received_invoices set document_exchange_rate=round(p_exchange_rate,6),document_exchange_rate_date=p_exchange_rate_date,
    document_exchange_rate_source=coalesce(nullif(btrim(p_exchange_rate_source),''),'BNR'),updated_at=now() where id=d.id;
  perform public.write_audit_log('received_invoice_fx_set','received_invoice',d.id,
    jsonb_build_object('exchange_rate',round(p_exchange_rate,6),'exchange_rate_date',p_exchange_rate_date,'source',p_exchange_rate_source));
  return jsonb_build_object('success',true,'invoice_id',d.id,'currency',d.currency,'exchange_rate',round(p_exchange_rate,6));
end $$;

create or replace function public.save_other_operation(
  p_id uuid,p_direction text,p_transaction_type text,p_amount numeric,p_transaction_date date,p_currency text default 'RON',
  p_payment_method text default 'BANK',p_bank_account_id uuid default null,p_description text default null,p_category text default null,
  p_fiscal_treatment text default null,p_document_type text default null,p_document_number text default null,p_document_date date default null,
  p_notes text default null,p_counterparty_name text default null,p_reference text default null,p_deductibility_percent numeric default null,
  p_deductibility_limit numeric default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=public.get_auth_user_id(); transaction_id uuid; amount_value numeric:=round(p_amount,2);
begin
  if p_id is not null then raise exception 'Operațiunile confirmate nu se modifică; anulați și înregistrați o operațiune nouă'; end if;
  if p_currency<>'RON' then raise exception 'Operațiunile non-factură în valută necesită flux FX dedicat; folosiți RON'; end if;
  if p_transaction_date is null or amount_value<=0 then raise exception 'Data și suma pozitivă sunt obligatorii'; end if;
  if p_direction not in ('IN','OUT') or p_transaction_type not in ('OTHER_IN','OTHER_OUT','ADJUSTMENT') then raise exception 'Tip sau direcție invalidă'; end if;
  if (p_transaction_type='OTHER_IN' and p_direction<>'IN') or (p_transaction_type='OTHER_OUT' and p_direction<>'OUT') then raise exception 'Direcția nu corespunde tipului'; end if;
  if p_fiscal_treatment is null or p_fiscal_treatment not in ('INCOME','DEDUCTIBLE_EXPENSE','NON_DEDUCTIBLE_EXPENSE','CASH_MOVEMENT') then raise exception 'Tratamentul fiscal este obligatoriu'; end if;
  if (p_direction='IN' and p_fiscal_treatment not in ('INCOME','CASH_MOVEMENT')) or
     (p_direction='OUT' and p_fiscal_treatment not in ('DEDUCTIBLE_EXPENSE','NON_DEDUCTIBLE_EXPENSE','CASH_MOVEMENT')) then raise exception 'Tratamentul fiscal nu corespunde direcției'; end if;
  if p_deductibility_percent is not null and (p_deductibility_percent<0 or p_deductibility_percent>100) then raise exception 'Procent deductibilitate invalid'; end if;
  if p_deductibility_limit is not null and p_deductibility_limit<0 then raise exception 'Plafon deductibilitate invalid'; end if;
  if p_bank_account_id is not null and not exists(select 1 from public.bank_accounts where id=p_bank_account_id and owner_user_id=u) then raise exception 'Cont bancar invalid sau acces interzis'; end if;

  insert into public.financial_transactions(owner_user_id,direction,transaction_type,amount,transaction_date,currency,payment_method,
    bank_account_id,description,category,fiscal_treatment,document_type,document_number,document_date,notes,counterparty_name,reference,
    status,deductibility_percent,deductibility_limit,idempotency_key,created_by)
  values(u,p_direction,p_transaction_type,amount_value,p_transaction_date,'RON',p_payment_method,p_bank_account_id,
    coalesce(nullif(btrim(p_description),''),p_transaction_type),p_category,p_fiscal_treatment,p_document_type,p_document_number,p_document_date,
    p_notes,p_counterparty_name,p_reference,'CONFIRMED',p_deductibility_percent,p_deductibility_limit,gen_random_uuid()::text,u)
  returning id into transaction_id;
  perform public.write_audit_log('other_operation_created','financial_transaction',transaction_id,
    jsonb_build_object('direction',p_direction,'amount',amount_value,'fiscal_treatment',p_fiscal_treatment));
  return transaction_id;
end $$;

create or replace function public.cancel_other_operation(p_transaction_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.get_auth_user_id(); transaction_id uuid;
begin
  select ft.id into transaction_id from public.financial_transactions ft
  where ft.id=p_transaction_id and ft.owner_user_id=u and ft.status='CONFIRMED'
    and ft.transaction_type in ('OTHER_IN','OTHER_OUT','ADJUSTMENT','OWN_CONTRIBUTION','OWN_CONTRIBUTION_RETURN')
    and not exists(select 1 from public.transaction_allocations ta where ta.transaction_id=ft.id) for update;
  if transaction_id is null then raise exception 'Operațiunea nu există, este deja anulată sau nu poate fi anulată'; end if;
  update public.financial_transactions set status='CANCELLED',updated_at=now() where id=transaction_id;
  perform public.write_audit_log('financial_transaction_cancelled','financial_transaction',transaction_id,'{}'::jsonb);
  return jsonb_build_object('success',true,'transaction_id',transaction_id);
end $$;

-- ---------------------------------------------------------------------------
-- Comparable daily/monthly KPI values are RON cash equivalents. Document
-- currency remains available on transaction-level and yearly per-currency view.
-- ---------------------------------------------------------------------------
create or replace view public.daily_cashflow_summary with (security_invoker=true) as
select owner_user_id,transaction_date,
  round(sum(coalesce(bank_amount_ron,amount_ron,case when currency='RON' then amount end)) filter(where direction='IN'),2) total_in,
  round(sum(coalesce(bank_amount_ron,amount_ron,case when currency='RON' then amount end)+coalesce(bank_fee_ron,0)) filter(where direction='OUT'),2) total_out
from public.financial_transactions where status='CONFIRMED' and owner_user_id=(select auth.uid())
group by owner_user_id,transaction_date;

create or replace view public.monthly_cashflow_summary with (security_invoker=true) as
select owner_user_id,date_trunc('month',transaction_date::timestamp)::date month_start,
  extract(year from transaction_date)::integer as "year",extract(month from transaction_date)::integer as "month",
  round(sum(case when direction='IN' then coalesce(bank_amount_ron,amount_ron,case when currency='RON' then amount end) else 0 end),2) total_in,
  round(sum(case when direction='OUT' then coalesce(bank_amount_ron,amount_ron,case when currency='RON' then amount end)+coalesce(bank_fee_ron,0) else 0 end),2) total_out
from public.financial_transactions where status='CONFIRMED'
group by owner_user_id,date_trunc('month',transaction_date::timestamp)::date,extract(year from transaction_date)::integer,extract(month from transaction_date)::integer;

grant select on public.daily_cashflow_summary,public.monthly_cashflow_summary to authenticated;

-- Superseded RPCs could otherwise bypass the immutable FX/document workflow.
revoke execute on function public.set_received_invoice_exchange_rate(uuid,numeric,date,text) from authenticated;
revoke execute on function public.register_fx_transaction(text,uuid,numeric,date,numeric,date,numeric,text,uuid,text,text,text,text) from authenticated;

commit;
