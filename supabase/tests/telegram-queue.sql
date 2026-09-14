\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'Queue assertion: %',label; end if; end $$;
do $$
declare result jsonb; target_idea_id uuid; created_episode uuid; before_count integer;
begin
  update public.system_config set value='{"enabled":true,"max_pending":100,"max_additions_per_day":2}' where key='telegram_queue';
  select count(*) into before_count from public.episodes;
  result:=public.telegram_queue_command(20001,'-123','456','idea','Carregador compacto para organizar a mesa de trabalho.',null,'https://example.com/product?affiliate=demo');
  target_idea_id:=(result->>'idea_id')::uuid;
  perform pg_temp.expect(result->>'code'='created' and result->'commercial'='true'::jsonb,'idea with affiliate recorded');
  perform pg_temp.expect((select count(*)=before_count from public.episodes),'adding idea never creates episode directly');
  perform pg_temp.expect((select status='pending' and niche='gadgets_produtos_inovadores' from public.idea_queue where id=target_idea_id),'existing queue reused');
  result:=public.telegram_queue_command(20001,'-123','456','idea','Carregador compacto para organizar a mesa de trabalho.',null,'https://example.com/product?affiliate=demo');
  perform pg_temp.expect(result->'duplicate'='true'::jsonb,'duplicate update ignored');
  begin
    perform public.telegram_queue_command(20001,'-123','456','idea','Outro texto longo para uma pauta diferente.',null,null);
    raise exception 'Changed replay accepted';
  exception when check_violation then null; end;
  begin
    perform public.telegram_queue_command(20001,'-123','999','queue'); raise exception 'Changed identity accepted';
  exception when check_violation then null; end;
  result:=public.telegram_queue_command(20002,'-123','456','queue');
  perform pg_temp.expect(result->>'code'='queue','queue read');
  perform pg_temp.expect(exists(select 1 from jsonb_array_elements(result->'items') item where item->>'id'=target_idea_id::text),'queue includes idea');
  result:=public.telegram_queue_command(20003,'-123','456','cancel',null,target_idea_id);
  perform pg_temp.expect(result->>'code'='cancelled','pending idea cancelled');
  perform pg_temp.expect((select status='rejected' from public.idea_queue where id=target_idea_id),'existing rejected state');
  result:=public.telegram_queue_command(20004,'-123','456','cancel',null,target_idea_id);
  perform pg_temp.expect(result->>'code'='already_cancelled','second cancellation is harmless');
  result:=public.telegram_queue_command(20005,'-123','456','idea','Comparar organizadores de cabos para uma mesa compacta.',null,'https://example.com/affiliate');
  target_idea_id:=(result->>'idea_id')::uuid;
  perform pg_temp.expect(result->>'code'='created','second addition accepted');
  result:=public.telegram_queue_command(20006,'-123','456','idea','Uma terceira pauta para verificar o limite do dia.');
  perform pg_temp.expect(result->>'code'='daily_limit','cancellation does not reset daily limit');
  perform pg_temp.expect((select reply_status='sending' and c.result->>'code'='daily_limit' from public.telegram_commands c where update_id=20006),'result and mutation recorded together');
  update public.system_config set value=value||'{"max_pending":1}' where key='telegram_queue';
  result:=public.telegram_queue_command(20007,'-123','456','idea','Mais uma pauta que não cabe na fila atual.');
  perform pg_temp.expect(result->>'code'='queue_full','pending capacity enforced');
  update public.idea_queue set priority=-1000000 where id=target_idea_id;
  update public.system_config set value=value||'{"max_episodes_per_day":100}' where key='pipeline';
  select c.episode_id into created_episode from public.consume_next_idea() c where c.idea_id=target_idea_id;
  perform pg_temp.expect(created_episode is not null,'existing consumer creates the episode');
  perform pg_temp.expect((select product_compliance->>'affiliate_link'='https://example.com/affiliate'
    and product_compliance->'commercial_content'='true'::jsonb from public.episodes where id=created_episode),'affiliate disclosure preserved into episode');
  result:=public.telegram_queue_command(20008,'-123','456','cancel',null,target_idea_id);
  perform pg_temp.expect(result->>'code'='already_started','cannot cancel an episode through queue');
  perform pg_temp.expect((select status='idea' from public.episodes where id=created_episode),'episode preserved');
  result:=public.telegram_queue_command(20009,'-123','456','queue');
  perform pg_temp.expect(exists(select 1 from jsonb_array_elements(result->'recent') item where item->>'episode_id'=created_episode::text),'recent episode discoverable');
  update public.system_config set value=value||'{"enabled":false}' where key='telegram_queue';
  result:=public.telegram_queue_command(20010,'-123','456','idea','Uma pauta que não entra quando a fila está pausada.');
  perform pg_temp.expect(result->>'code'='disabled','feature flag respected');
  result:=public.telegram_queue_command(20012,'-123','456','queue');
  perform pg_temp.expect(result->>'code'='queue','read-only queue remains available while paused');
  begin
    perform public.telegram_queue_command(20011,'-123','456','idea','curto'); raise exception 'Invalid briefing accepted';
  exception when check_violation then null; end;
  perform pg_temp.expect(not exists(select 1 from public.telegram_commands where update_id=20011),'invalid request leaves no ledger');
end $$;
select pg_temp.expect(not has_function_privilege('anon','public.telegram_queue_command(bigint,text,text,text,text,uuid,text)','execute'),'anon RPC denied');
select pg_temp.expect(not has_function_privilege('authenticated','public.telegram_queue_command(bigint,text,text,text,text,uuid,text)','execute'),'authenticated RPC denied');
grant select on public.idea_queue,public.telegram_commands to anon;
set local role anon;
select pg_temp.expect((select count(*)=0 from public.idea_queue),'queue RLS');
select pg_temp.expect((select count(*)=0 from public.telegram_commands),'commands RLS');
reset role;
rollback;
