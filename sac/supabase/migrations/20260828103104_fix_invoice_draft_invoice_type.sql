do $migration$
declare
  function_sql text;
  updated_sql text;
begin
  function_sql := pg_get_functiondef(
    'public.save_invoice_draft(uuid,uuid,date,date,text,integer,text,jsonb)'::regprocedure
  );

  updated_sql := replace(
    function_sql,
    '0, ROUND(v_total, 2), ''NORMAL''',
    '0, ROUND(v_total, 2), ''INVOICE'''
  );

  if updated_sql = function_sql then
    raise exception 'Expected invoice_type assignment was not found in save_invoice_draft';
  end if;

  execute updated_sql;
end;
$migration$;
