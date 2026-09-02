alter view public.fiscal_monthly_summary rename to fiscal_monthly_summary_fx_base;

create view public.fiscal_monthly_summary with (security_invoker=true) as
with fees as (
  select owner_user_id,date_trunc('month',transaction_date)::date month_start,
    extract(year from transaction_date)::int as year,extract(month from transaction_date)::int as month,
    round(sum(case when bank_fee_fiscal_treatment='DEDUCTIBLE_EXPENSE' then bank_fee_ron else 0 end),2) deductible_fee,
    round(sum(case when bank_fee_fiscal_treatment='NON_DEDUCTIBLE_EXPENSE' then bank_fee_ron else 0 end),2) non_deductible_fee
  from public.financial_transactions where status='CONFIRMED' and bank_fee_ron>0 group by 1,2,3,4
)
select b.owner_user_id,b.month_start,b.year,b.month,b.income,
 round(b.deductible_expenses+coalesce(f.deductible_fee,0),2) deductible_expenses,b.depreciation,
 round(b.non_deductible_expenses+coalesce(f.non_deductible_fee,0),2) non_deductible_expenses,
 b.owner_contributions,b.owner_withdrawals
from public.fiscal_monthly_summary_fx_base b left join fees f using(owner_user_id,month_start,year,month);

revoke all on public.fiscal_monthly_summary_fx_base from anon;
revoke all on public.fiscal_monthly_summary from anon;
grant select on public.fiscal_monthly_summary to authenticated;

create or replace function public.get_fiscal_summary(p_year integer default extract(year from current_date)::integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); i numeric:=0; d numeric:=0; n numeric:=0; dep numeric:=0; oc numeric:=0; ow numeric:=0; cm numeric:=0;
begin
 if u is null then raise exception 'Utilizator neautentificat'; end if;
 select coalesce(sum(income),0),coalesce(sum(deductible_expenses),0),coalesce(sum(non_deductible_expenses),0),coalesce(sum(depreciation),0),coalesce(sum(owner_contributions),0),coalesce(sum(owner_withdrawals),0)
 into i,d,n,dep,oc,ow from public.fiscal_monthly_summary where owner_user_id=u and year=p_year;
 select coalesce(sum(case when fiscal_treatment='CASH_MOVEMENT' then case when direction='IN' then fiscal_amount_ron else -fiscal_amount_ron end else 0 end),0)
   +coalesce(sum(case when fx_fiscal_treatment='CASH_MOVEMENT' then fx_cash_difference_ron else 0 end),0)
   +coalesce(sum(case when bank_fee_fiscal_treatment='CASH_MOVEMENT' then -bank_fee_ron else 0 end),0)
 into cm from public.financial_transactions where owner_user_id=u and status='CONFIRMED' and extract(year from transaction_date)::int=p_year;
 return jsonb_build_object('year',p_year,'income',round(i,2),'deductible_expenses',round(d,2),'non_deductible_expenses',round(n,2),'depreciation',round(dep,2),'owner_contributions',round(oc,2),'owner_withdrawals',round(ow,2),'cash_movements',round(cm,2),'net_income',round(i-d,2));
end $$;
revoke all on function public.get_fiscal_summary(integer) from public,anon;
grant execute on function public.get_fiscal_summary(integer) to authenticated;

