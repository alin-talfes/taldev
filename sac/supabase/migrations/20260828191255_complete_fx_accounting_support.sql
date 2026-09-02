-- Complete the partially deployed FX model. PostgreSQL remains the source of truth.
alter table public.financial_transactions
  add column if not exists document_currency text,
  add column if not exists foreign_amount numeric,
  add column if not exists fiscal_amount_ron numeric,
  add column if not exists exchange_rate_source text,
  add column if not exists fx_difference_ron numeric not null default 0,
  add column if not exists bank_fee_ron numeric not null default 0,
  add column if not exists bank_fee_fiscal_treatment text,
  add column if not exists bank_settlement_amount numeric,
  add column if not exists bank_settlement_currency text;

alter table public.financial_transactions drop constraint if exists financial_transactions_bank_fee_nonnegative;
alter table public.financial_transactions add constraint financial_transactions_bank_fee_nonnegative check (bank_fee_ron >= 0);
alter table public.financial_transactions drop constraint if exists financial_transactions_bank_fee_treatment_check;
alter table public.financial_transactions add constraint financial_transactions_bank_fee_treatment_check
  check (bank_fee_fiscal_treatment is null or bank_fee_fiscal_treatment in ('DEDUCTIBLE_EXPENSE','NON_DEDUCTIBLE_EXPENSE','CASH_MOVEMENT'));

update public.financial_transactions set document_currency=currency,
 foreign_amount=case when currency='RON' then null else amount end,
 fiscal_amount_ron=coalesce(amount_ron,amount),exchange_rate_source=coalesce(fx_source,case when currency<>'RON' then 'BNR' end)
where document_currency is null or fiscal_amount_ron is null;
alter table public.financial_transactions alter column document_currency set not null;
alter table public.financial_transactions alter column fiscal_amount_ron set not null;

create or replace function public.set_financial_transaction_fx_values()
returns trigger language plpgsql set search_path='' as $$
declare v_fiscal numeric;
begin
  new.currency := upper(coalesce(new.currency,'RON'));
  new.amount := round(new.amount,2);
  new.document_currency := new.currency;
  new.foreign_amount := case when new.currency='RON' then null else new.amount end;
  new.bank_fee_ron := round(coalesce(new.bank_fee_ron,0),2);
  if new.bank_fee_ron < 0 then raise exception 'Comisionul bancar nu poate fi negativ'; end if;
  if new.currency='RON' then
    new.amount_ron:=new.amount; new.fiscal_amount_ron:=new.amount;
    new.exchange_rate:=null; new.exchange_rate_date:=null; new.fx_source:=null; new.exchange_rate_source:=null;
    new.fx_cash_difference_ron:=0; new.fx_difference_ron:=0; new.fx_fiscal_treatment:=null;
    return new;
  end if;
  if new.exchange_rate is null or new.exchange_rate<=0 or new.exchange_rate_date is null then
    raise exception 'Operațiunea în % necesită cursul BNR și data cursului',new.currency;
  end if;
  if new.transaction_date is null or new.exchange_rate_date>=new.transaction_date then
    raise exception 'Data cursului trebuie să fie ultima zi bancară anterioară operațiunii';
  end if;
  new.exchange_rate:=round(new.exchange_rate,6);
  new.exchange_rate_source:=coalesce(nullif(btrim(new.exchange_rate_source),''),nullif(btrim(new.fx_source),''),'BNR');
  new.fx_source:=new.exchange_rate_source;
  v_fiscal:=round(new.amount*new.exchange_rate,2);
  new.amount_ron:=v_fiscal; new.fiscal_amount_ron:=v_fiscal;
  if new.bank_amount_ron is not null then
    new.bank_amount_ron:=round(new.bank_amount_ron,2);
    new.fx_difference_ron:=round(new.bank_amount_ron-v_fiscal,2); -- raw bank minus fiscal; 505-497 = +8
    new.fx_cash_difference_ron:=case when new.direction='IN' then new.fx_difference_ron else -new.fx_difference_ron end;
  else new.fx_difference_ron:=0; new.fx_cash_difference_ron:=0; end if;
  if new.bank_settlement_amount is not null then new.bank_settlement_amount:=round(new.bank_settlement_amount,2); end if;
  new.bank_settlement_currency:=upper(nullif(btrim(new.bank_settlement_currency),''));
  return new;
end $$;

drop function if exists public.register_receipt(uuid,numeric,date,text,uuid,text,text);
drop function if exists public.register_payment(uuid,numeric,date,text,uuid,text,text);
drop function if exists public.register_invoice_refund(uuid,numeric,date,text,uuid,text,text);
drop function if exists public.register_supplier_refund(uuid,numeric,date,text,uuid,text,text);

create or replace function public.register_receipt(
 p_invoice_id uuid,p_amount numeric,p_transaction_date date default current_date,p_payment_method text default 'BANK',
 p_bank_account_id uuid default null,p_notes text default null,p_idempotency_key text default null,
 p_exchange_rate numeric default null,p_exchange_rate_date date default null,p_exchange_rate_source text default null,
 p_bank_amount_ron numeric default null,p_bank_settlement_amount numeric default null,p_bank_settlement_currency text default null,
 p_bank_fee_ron numeric default 0,p_fx_fiscal_treatment text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; d record; tid uuid; a numeric; existing record;
begin
 u:=public.get_auth_user_id(); a:=round(p_amount,2);
 select * into d from public.invoices where id=p_invoice_id and owner_user_id=u for update;
 if d is null or d.document_status<>'ISSUED' or d.invoice_type<>'INVOICE' then raise exception 'Factura nu este eligibilă pentru încasare'; end if;
 if a<=0 or a>d.balance_due then raise exception 'Suma depășește soldul de încasat (%)',d.balance_due; end if;
 if p_bank_account_id is not null and not exists(select 1 from public.bank_accounts where id=p_bank_account_id and owner_user_id=u) then raise exception 'Cont bancar invalid'; end if;
 if p_idempotency_key is not null then select * into existing from public.financial_transactions where owner_user_id=u and idempotency_key=p_idempotency_key; if existing is not null then return jsonb_build_object('success',true,'transaction_id',existing.id,'reused',true); end if; end if;
 insert into public.financial_transactions(owner_user_id,transaction_date,direction,transaction_type,amount,currency,payment_method,bank_account_id,description,status,idempotency_key,created_by,exchange_rate,exchange_rate_date,exchange_rate_source,bank_amount_ron,bank_settlement_amount,bank_settlement_currency,bank_fee_ron,bank_fee_fiscal_treatment,fx_fiscal_treatment)
 values(u,p_transaction_date,'IN','RECEIPT',a,d.currency,p_payment_method,p_bank_account_id,coalesce(p_notes,'Încasare factură'),'CONFIRMED',p_idempotency_key,u,p_exchange_rate,p_exchange_rate_date,p_exchange_rate_source,p_bank_amount_ron,p_bank_settlement_amount,p_bank_settlement_currency,coalesce(p_bank_fee_ron,0),case when coalesce(p_bank_fee_ron,0)>0 then 'DEDUCTIBLE_EXPENSE' end,p_fx_fiscal_treatment) returning id into tid;
 insert into public.transaction_allocations(transaction_id,invoice_id,allocated_amount,allocated_amount_ron) values(tid,p_invoice_id,a,round(a*case when d.currency='RON' then 1 else p_exchange_rate end,2));
 update public.invoices set paid_total=round(paid_total+a,2),balance_due=round(balance_due-a,2),payment_status=case when round(balance_due-a,2)=0 then 'PAID' else 'PARTIALLY_PAID' end,updated_at=now() where id=p_invoice_id;
 return jsonb_build_object('success',true,'transaction_id',tid,'foreign_amount',a,'currency',d.currency);
end $$;

create or replace function public.register_invoice_refund(
 p_invoice_id uuid,p_amount numeric,p_transaction_date date default current_date,p_payment_method text default 'BANK',p_bank_account_id uuid default null,p_notes text default null,p_idempotency_key text default null,
 p_exchange_rate numeric default null,p_exchange_rate_date date default null,p_exchange_rate_source text default null,p_bank_amount_ron numeric default null,p_bank_settlement_amount numeric default null,p_bank_settlement_currency text default null,p_bank_fee_ron numeric default 0,p_fx_fiscal_treatment text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; d record; tid uuid; a numeric; refunded numeric; available numeric; existing record;
begin u:=public.get_auth_user_id(); a:=round(p_amount,2); select * into d from public.invoices where id=p_invoice_id and owner_user_id=u for update;
 if d is null or d.document_status not in ('STORNED','CORRECTED','VOIDED') then raise exception 'Factura nu este eligibilă pentru restituire'; end if;
 select coalesce(sum(ta.allocated_amount),0) into refunded from public.transaction_allocations ta join public.financial_transactions ft on ft.id=ta.transaction_id where ta.invoice_id=p_invoice_id and ft.status='CONFIRMED' and ft.transaction_type='REFUND_OUT'; available:=greatest(d.paid_total-refunded,0);
 if a<=0 or a>available then raise exception 'Suma depășește plafonul refundului (%)',available; end if;
 if p_idempotency_key is not null then select * into existing from public.financial_transactions where owner_user_id=u and idempotency_key=p_idempotency_key; if existing is not null then return jsonb_build_object('success',true,'transaction_id',existing.id,'reused',true); end if; end if;
 insert into public.financial_transactions(owner_user_id,transaction_date,direction,transaction_type,amount,currency,payment_method,bank_account_id,description,status,idempotency_key,created_by,exchange_rate,exchange_rate_date,exchange_rate_source,bank_amount_ron,bank_settlement_amount,bank_settlement_currency,bank_fee_ron,bank_fee_fiscal_treatment,fx_fiscal_treatment)
 values(u,p_transaction_date,'OUT','REFUND_OUT',a,d.currency,p_payment_method,p_bank_account_id,coalesce(p_notes,'Restituire factură'),'CONFIRMED',p_idempotency_key,u,p_exchange_rate,p_exchange_rate_date,p_exchange_rate_source,p_bank_amount_ron,p_bank_settlement_amount,p_bank_settlement_currency,coalesce(p_bank_fee_ron,0),case when coalesce(p_bank_fee_ron,0)>0 then 'DEDUCTIBLE_EXPENSE' end,p_fx_fiscal_treatment) returning id into tid;
 insert into public.transaction_allocations(transaction_id,invoice_id,allocated_amount,allocated_amount_ron) values(tid,p_invoice_id,a,round(a*case when d.currency='RON' then 1 else p_exchange_rate end,2)); return jsonb_build_object('success',true,'transaction_id',tid,'amount',a,'remaining_refundable',available-a); end $$;

create or replace function public.register_supplier_refund(
 p_received_invoice_id uuid,p_amount numeric,p_transaction_date date default current_date,p_payment_method text default 'BANK',p_bank_account_id uuid default null,p_notes text default null,p_idempotency_key text default null,
 p_exchange_rate numeric default null,p_exchange_rate_date date default null,p_exchange_rate_source text default null,p_bank_amount_ron numeric default null,p_bank_settlement_amount numeric default null,p_bank_settlement_currency text default null,p_bank_fee_ron numeric default 0,p_fx_fiscal_treatment text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; d record; tid uuid; a numeric; refunded numeric; available numeric; existing record;
begin u:=public.get_auth_user_id(); a:=round(p_amount,2); select * into d from public.received_invoices where id=p_received_invoice_id and owner_user_id=u for update;
 if d is null then raise exception 'Factura primită nu există'; end if;
 select coalesce(sum(ta.allocated_amount),0) into refunded from public.transaction_allocations ta join public.financial_transactions ft on ft.id=ta.transaction_id where ta.received_invoice_id=p_received_invoice_id and ft.status='CONFIRMED' and ft.transaction_type='REFUND_IN'; available:=greatest(d.paid_total-refunded,0);
 if a<=0 or a>available then raise exception 'Suma depășește plafonul refundului (%)',available; end if;
 if p_idempotency_key is not null then select * into existing from public.financial_transactions where owner_user_id=u and idempotency_key=p_idempotency_key; if existing is not null then return jsonb_build_object('success',true,'transaction_id',existing.id,'reused',true); end if; end if;
 insert into public.financial_transactions(owner_user_id,transaction_date,direction,transaction_type,amount,currency,payment_method,bank_account_id,description,status,idempotency_key,created_by,exchange_rate,exchange_rate_date,exchange_rate_source,bank_amount_ron,bank_settlement_amount,bank_settlement_currency,bank_fee_ron,bank_fee_fiscal_treatment,fx_fiscal_treatment)
 values(u,p_transaction_date,'IN','REFUND_IN',a,d.currency,p_payment_method,p_bank_account_id,coalesce(p_notes,'Refund furnizor'),'CONFIRMED',p_idempotency_key,u,p_exchange_rate,p_exchange_rate_date,p_exchange_rate_source,p_bank_amount_ron,p_bank_settlement_amount,p_bank_settlement_currency,coalesce(p_bank_fee_ron,0),case when coalesce(p_bank_fee_ron,0)>0 then 'DEDUCTIBLE_EXPENSE' end,p_fx_fiscal_treatment) returning id into tid;
 insert into public.transaction_allocations(transaction_id,received_invoice_id,allocated_amount,allocated_amount_ron) values(tid,p_received_invoice_id,a,round(a*case when d.currency='RON' then 1 else p_exchange_rate end,2)); return jsonb_build_object('success',true,'transaction_id',tid,'amount',a,'remaining_refundable',available-a); end $$;

create or replace function public.register_payment(
 p_received_invoice_id uuid,p_amount numeric,p_transaction_date date default current_date,p_payment_method text default 'BANK',
 p_bank_account_id uuid default null,p_notes text default null,p_idempotency_key text default null,
 p_exchange_rate numeric default null,p_exchange_rate_date date default null,p_exchange_rate_source text default null,
 p_bank_amount_ron numeric default null,p_bank_settlement_amount numeric default null,p_bank_settlement_currency text default null,
 p_bank_fee_ron numeric default 0,p_fx_fiscal_treatment text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; d record; tid uuid; a numeric; existing record;
begin
 u:=public.get_auth_user_id(); a:=round(p_amount,2);
 select * into d from public.received_invoices where id=p_received_invoice_id and owner_user_id=u for update;
 if d is null or d.document_status not in ('RECEIVED','CONFIRMED') or d.invoice_type<>'NORMAL' then raise exception 'Factura nu este eligibilă pentru plată'; end if;
 if a<=0 or a>d.balance_due then raise exception 'Suma depășește soldul de plată (%)',d.balance_due; end if;
 if p_bank_account_id is not null and not exists(select 1 from public.bank_accounts where id=p_bank_account_id and owner_user_id=u) then raise exception 'Cont bancar invalid'; end if;
 if p_idempotency_key is not null then select * into existing from public.financial_transactions where owner_user_id=u and idempotency_key=p_idempotency_key; if existing is not null then return jsonb_build_object('success',true,'transaction_id',existing.id,'reused',true); end if; end if;
 insert into public.financial_transactions(owner_user_id,transaction_date,direction,transaction_type,amount,currency,payment_method,bank_account_id,description,status,idempotency_key,created_by,exchange_rate,exchange_rate_date,exchange_rate_source,bank_amount_ron,bank_settlement_amount,bank_settlement_currency,bank_fee_ron,bank_fee_fiscal_treatment,fx_fiscal_treatment)
 values(u,p_transaction_date,'OUT','PAYMENT',a,d.currency,p_payment_method,p_bank_account_id,coalesce(p_notes,'Plată factură'),'CONFIRMED',p_idempotency_key,u,p_exchange_rate,p_exchange_rate_date,p_exchange_rate_source,p_bank_amount_ron,p_bank_settlement_amount,p_bank_settlement_currency,coalesce(p_bank_fee_ron,0),case when coalesce(p_bank_fee_ron,0)>0 then 'DEDUCTIBLE_EXPENSE' end,p_fx_fiscal_treatment) returning id into tid;
 insert into public.transaction_allocations(transaction_id,received_invoice_id,allocated_amount,allocated_amount_ron) values(tid,p_received_invoice_id,a,round(a*case when d.currency='RON' then 1 else p_exchange_rate end,2));
 update public.received_invoices set paid_total=round(paid_total+a,2),balance_due=round(balance_due-a,2),payment_status=case when round(balance_due-a,2)=0 then 'PAID' else 'PARTIALLY_PAID' end,updated_at=now() where id=p_received_invoice_id;
 return jsonb_build_object('success',true,'transaction_id',tid,'foreign_amount',a,'currency',d.currency);
end $$;

revoke all on function public.register_receipt(uuid,numeric,date,text,uuid,text,text,numeric,date,text,numeric,numeric,text,numeric,text) from public,anon;
revoke all on function public.register_payment(uuid,numeric,date,text,uuid,text,text,numeric,date,text,numeric,numeric,text,numeric,text) from public,anon;
grant execute on function public.register_receipt(uuid,numeric,date,text,uuid,text,text,numeric,date,text,numeric,numeric,text,numeric,text) to authenticated;
grant execute on function public.register_payment(uuid,numeric,date,text,uuid,text,text,numeric,date,text,numeric,numeric,text,numeric,text) to authenticated;
revoke all on function public.register_invoice_refund(uuid,numeric,date,text,uuid,text,text,numeric,date,text,numeric,numeric,text,numeric,text) from public,anon;
revoke all on function public.register_supplier_refund(uuid,numeric,date,text,uuid,text,text,numeric,date,text,numeric,numeric,text,numeric,text) from public,anon;
grant execute on function public.register_invoice_refund(uuid,numeric,date,text,uuid,text,text,numeric,date,text,numeric,numeric,text,numeric,text) to authenticated;
grant execute on function public.register_supplier_refund(uuid,numeric,date,text,uuid,text,text,numeric,date,text,numeric,numeric,text,numeric,text) to authenticated;

-- Keep the existing fiscal view/RPC formula for principal and FX gain/loss; it already aggregates amount_ron.
-- Bank fees are stored separately and deliberately require their own classification trail.
create or replace view public.rjip_view with (security_invoker=true) as
select ft.id transaction_id,ft.owner_user_id,ft.transaction_date,ft.direction,ft.transaction_type,ft.description,
 ft.counterparty_name,ft.reference,ft.payment_method,ft.fiscal_amount_ron::numeric(15,2) amount,'RON'::text currency,
 ft.status,ba.bank_name,ba.iban,
 coalesce((select string_agg(distinct c.legal_name,', ') from public.transaction_allocations ta join public.invoices i on i.id=ta.invoice_id join public.clients c on c.id=i.client_id where ta.transaction_id=ft.id),(select string_agg(distinct s.legal_name,', ') from public.transaction_allocations ta join public.received_invoices ri on ri.id=ta.received_invoice_id join public.suppliers s on s.id=ri.supplier_id where ta.transaction_id=ft.id)) counterparty_name_resolved,
 (select string_agg(distinct i.series,', ') from public.transaction_allocations ta join public.invoices i on i.id=ta.invoice_id where ta.transaction_id=ft.id) invoice_series,
 (select string_agg(distinct i.number::text,', ') from public.transaction_allocations ta join public.invoices i on i.id=ta.invoice_id where ta.transaction_id=ft.id) invoice_number,
 (select string_agg(distinct ri.series,', ') from public.transaction_allocations ta join public.received_invoices ri on ri.id=ta.received_invoice_id where ta.transaction_id=ft.id) received_invoice_series,
 (select string_agg(distinct ri.number,', ') from public.transaction_allocations ta join public.received_invoices ri on ri.id=ta.received_invoice_id where ta.transaction_id=ft.id) received_invoice_number,
 ft.foreign_amount::numeric(15,2) original_amount,ft.document_currency original_currency,ft.exchange_rate,ft.exchange_rate_date,ft.bank_amount_ron,
 ft.fx_cash_difference_ron,ft.fx_fiscal_treatment,ft.exchange_rate_source fx_source,
 case when ft.document_currency='RON' then null else format('%s %s × %s (%s, %s) = %s RON; bancă %s RON; diferență %s RON; comision %s RON',ft.foreign_amount,ft.document_currency,ft.exchange_rate,ft.exchange_rate_date,ft.exchange_rate_source,ft.fiscal_amount_ron,ft.bank_amount_ron,ft.fx_difference_ron,ft.bank_fee_ron) end fx_explanation,
 ft.fx_difference_ron,ft.bank_fee_ron,ft.bank_settlement_amount,ft.bank_settlement_currency
from public.financial_transactions ft left join public.bank_accounts ba on ba.id=ft.bank_account_id where ft.status='CONFIRMED';

revoke all on public.rjip_view from anon;
grant select on public.rjip_view to authenticated;

comment on column public.financial_transactions.fiscal_amount_ron is 'Canonical fiscal/accounting value in RON, derived by trigger.';
comment on column public.financial_transactions.fx_difference_ron is 'Raw bank_amount_ron minus fiscal_amount_ron; not automatically fiscal.';
comment on column public.transaction_allocations.allocated_amount is 'Amount in the document currency; controls document balance.';

