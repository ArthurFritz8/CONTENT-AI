\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'Web panel assertion: %',label; end if; end $$;
do $$
declare command_id uuid:=gen_random_uuid(); actor_id uuid:=gen_random_uuid(); idea_id uuid; result jsonb; payload jsonb;
  cfg public.system_config; queue_count int;
begin
  update public.system_config set value='{"enabled":true,"max_pending":100,"max_additions_per_day":100}' where key='telegram_queue';
  payload:='{"briefing":"Produto real para organizar a mesa de trabalho.","priority":30,"affiliate_links":{"youtube":"https://amazon.example/item?tag=creator","tiktok":"https://shop.tiktok.example/item?affiliate=creator"}}';
  result:=public.web_panel_mutation(command_id,actor_id,'add',payload);
  idea_id:=(result->>'idea_id')::uuid;
  perform pg_temp.expect(result->>'code'='created','create queue item');
  perform pg_temp.expect((select affiliate_links->>'youtube'='https://amazon.example/item?tag=creator'
    and affiliate_links->>'tiktok'='https://shop.tiktok.example/item?affiliate=creator'
    and product_url is null from public.idea_queue where id=idea_id),'platform links stored without generic link');
  perform pg_temp.expect(public.web_panel_mutation(command_id,actor_id,'add',payload)=result,'same request is idempotent');
  begin
    perform public.web_panel_mutation(command_id,gen_random_uuid(),'add',payload);raise exception 'Impersonated replay accepted';
  exception when check_violation then null; end;
  begin
    perform public.web_panel_mutation(command_id,actor_id,'add',payload||'{"priority":2}');raise exception 'Changed replay accepted';
  exception when check_violation then null; end;
  result:=public.web_panel_mutation(gen_random_uuid(),actor_id,'edit',payload||jsonb_build_object('id',idea_id,'revision',0,'priority',20));
  perform pg_temp.expect(result->>'code'='updated','edit current revision');
  perform pg_temp.expect((select priority=20 and revision=1 from public.idea_queue where id=idea_id),'revision bumped');
  result:=public.web_panel_mutation(gen_random_uuid(),actor_id,'edit',payload||jsonb_build_object('id',idea_id,'revision',0,'priority',1));
  perform pg_temp.expect(result->>'code'='conflict','stale edit rejected');
  result:=public.web_panel_mutation(gen_random_uuid(),actor_id,'cancel',jsonb_build_object('id',idea_id,'revision',1));
  perform pg_temp.expect(result->>'code'='cancelled','pending item removed');
  result:=public.web_panel_mutation(gen_random_uuid(),actor_id,'edit',payload||jsonb_build_object('id',idea_id,'revision',2));
  perform pg_temp.expect(result->>'code'='already_started','removed item cannot be silently restored');
  select * into cfg from public.system_config where key='pipeline';
  result:=public.web_panel_mutation(gen_random_uuid(),actor_id,'pipeline',jsonb_build_object('revision',cfg.updated_at,'enabled',false,'max_episodes_per_day',2,'auto_publish',true,'require_human_approval',false));
  perform pg_temp.expect(result->>'code'='saved','pipeline saved');
  perform pg_temp.expect((select value->'auto_publish'='false'::jsonb and value->'require_human_approval'='true'::jsonb from public.system_config where key='pipeline'),'cannot bypass human review');
  result:=public.web_panel_mutation(gen_random_uuid(),actor_id,'pipeline',jsonb_build_object('revision','2000-01-01T00:00:00Z','enabled',true,'max_episodes_per_day',3));
  perform pg_temp.expect(result->>'code'='conflict','stale settings rejected');
  select * into cfg from public.system_config where key='niche';
  result:=public.web_panel_mutation(gen_random_uuid(),actor_id,'niche',jsonb_build_object('revision',cfg.updated_at,'focus','Produtos úteis para uma rotina organizada.'));
  perform pg_temp.expect(result->>'code'='saved','editorial focus saved');
  perform pg_temp.expect((select value->'name'=cfg.value->'name' from public.system_config where key='niche'),'unrelated settings preserved');
  select count(*) into queue_count from public.idea_queue where status='pending';
  update public.system_config set value=value||jsonb_build_object('max_pending',greatest(1,queue_count)) where key='telegram_queue';
  if queue_count=0 then perform public.web_panel_mutation(gen_random_uuid(),actor_id,'add',payload); end if;
  result:=public.web_panel_mutation(gen_random_uuid(),actor_id,'add',payload);
  perform pg_temp.expect(result->>'code'='queue_full','pending cap respected');
  update public.system_config set value=value||'{"enabled":false}' where key='telegram_queue';
  result:=public.web_panel_mutation(gen_random_uuid(),actor_id,'add',payload);
  perform pg_temp.expect(result->>'code'='disabled','disabled queue respected');
  begin
    perform public.web_panel_mutation(gen_random_uuid(),actor_id,'add',payload||'{"product_url":"https://user:password@example.com/a"}');raise exception 'URL credentials accepted';
  exception when check_violation then null; end;
  begin
    perform public.web_panel_mutation(gen_random_uuid(),actor_id,'add',payload||'{"affiliate_links":{"instagram":"https://example.com/a"}}');raise exception 'Unknown affiliate platform accepted';
  exception when check_violation then null; end;
end $$;
select pg_temp.expect(not has_function_privilege('anon','public.web_panel_mutation(uuid,uuid,text,jsonb)','execute'),'anon mutation denied');
select pg_temp.expect(not has_function_privilege('authenticated','public.web_panel_mutation(uuid,uuid,text,jsonb)','execute'),'authenticated direct mutation denied');
grant select on public.web_panel_commands to anon;
set local role anon;
select pg_temp.expect((select count(*)=0 from public.web_panel_commands),'audit log protected by RLS');
reset role;
rollback;
