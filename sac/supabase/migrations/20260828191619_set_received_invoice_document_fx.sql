create or replace function public.set_received_invoice_document_fx(p_received_invoice_id uuid,p_exchange_rate numeric,p_exchange_rate_date date,p_exchange_rate_source text default 'BNR')
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.get_auth_user_id(); d public.received_invoices%rowtype;
begin
 select * into d from public.received_invoices where id=p_received_invoice_id and owner_user_id=u for update;
 if d.id is null then raise exception 'Factura primită nu există sau acces interzis'; end if;
 if d.currency='RON' then raise exception 'Factura RON nu necesită curs valutar'; end if;
 if p_exchange_rate is null or p_exchange_rate<=0 then raise exception 'Curs invalid'; end if;
 if p_exchange_rate_date is null or p_exchange_rate_date>=d.document_date then raise exception 'Data cursului trebuie să fie ultima zi bancară anterioară documentului'; end if;
 update public.received_invoices set document_exchange_rate=round(p_exchange_rate,6),document_exchange_rate_date=p_exchange_rate_date,
 document_exchange_rate_source=coalesce(nullif(btrim(p_exchange_rate_source),''),'BNR'),updated_at=now() where id=d.id;
 return jsonb_build_object('success',true,'invoice_id',d.id,'currency',d.currency,'exchange_rate',round(p_exchange_rate,6));
end $$;
revoke all on function public.set_received_invoice_document_fx(uuid,numeric,date,text) from public,anon;
grant execute on function public.set_received_invoice_document_fx(uuid,numeric,date,text) to authenticated;

