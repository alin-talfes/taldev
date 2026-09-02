-- The normal issued-invoice discriminator in this schema is INVOICE (not NORMAL).
begin;

drop policy if exists invoices_update_normal_draft_only on public.invoices;
create policy invoices_update_invoice_draft_only on public.invoices
  for update to authenticated
  using (owner_user_id=(select auth.uid()) and document_status='DRAFT' and invoice_type='INVOICE')
  with check (owner_user_id=(select auth.uid()) and document_status='DRAFT' and invoice_type='INVOICE');

drop policy if exists invoice_lines_insert_normal_draft_only on public.invoice_lines;
create policy invoice_lines_insert_invoice_draft_only on public.invoice_lines
  for insert to authenticated with check (exists (
    select 1 from public.invoices i where i.id=invoice_id and i.owner_user_id=(select auth.uid())
      and i.document_status='DRAFT' and i.invoice_type='INVOICE'
  ));
drop policy if exists invoice_lines_update_normal_draft_only on public.invoice_lines;
create policy invoice_lines_update_invoice_draft_only on public.invoice_lines
  for update to authenticated
  using (exists (select 1 from public.invoices i where i.id=invoice_id and i.owner_user_id=(select auth.uid()) and i.document_status='DRAFT' and i.invoice_type='INVOICE'))
  with check (exists (select 1 from public.invoices i where i.id=invoice_id and i.owner_user_id=(select auth.uid()) and i.document_status='DRAFT' and i.invoice_type='INVOICE'));

create or replace function public.create_storno_invoice(
  p_original_invoice_id uuid,
  p_storno_type text default 'STORNO'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.get_auth_user_id(); original record; correction_id uuid; correction_total numeric;
begin
  select * into original from public.invoices where id=p_original_invoice_id for update;
  if original is null or original.owner_user_id<>u then raise exception 'Factura originală nu există sau acces interzis'; end if;
  if original.document_status<>'ISSUED' then raise exception 'Doar o factură emisă și necorectată poate fi stornată'; end if;
  if original.invoice_type not in ('INVOICE','CORRECTION') then raise exception 'Tipul facturii originale nu poate fi corectat'; end if;
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
  v_series_id uuid; v_series_name text; v_next_no bigint;
  gross numeric; discounts numeric; taxable numeric; vat numeric; total_value numeric; line_count integer; vat_status text;
begin
  select * into inv from public.invoices where id=p_invoice_id for update;
  if inv is null or inv.owner_user_id<>u then raise exception 'Factura nu există sau acces interzis'; end if;
  if inv.document_status<>'DRAFT' then raise exception 'Factura a fost deja emisă'; end if;
  if inv.client_id is null or not exists(select 1 from public.clients where id=inv.client_id and owner_user_id=u) then raise exception 'Client lipsă sau invalid'; end if;
  if inv.issue_date is null or inv.due_date is null or inv.due_date<inv.issue_date then raise exception 'Datele facturii sunt invalide'; end if;
  if inv.currency !~ '^[A-Z]{3}$' then raise exception 'Monedă invalidă'; end if;

  if inv.invoice_type='INVOICE' and exists(select 1 from public.invoice_lines where invoice_id=p_invoice_id and
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

  select s.id,s.series,s.next_number into v_series_id,v_series_name,v_next_no
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

commit;

