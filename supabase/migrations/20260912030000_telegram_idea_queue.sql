-- ADR-020: queue commands and their mutations commit together.
alter table public.telegram_commands drop constraint telegram_commands_command_check;
alter table public.telegram_commands add constraint telegram_commands_command_check
  check(command in ('help','review','idea','queue','cancel'));
alter table public.telegram_commands
  add column request_payload jsonb,
  add column result jsonb,
  add column reply_status text check(reply_status in ('sending','sent','uncertain','failed'));
grant update(reply_status) on public.telegram_commands to service_role;
insert into public.system_config(key,value) values('telegram_queue',
  '{"enabled":true,"max_pending":20,"max_additions_per_day":10}') on conflict(key) do nothing;

create function public.telegram_queue_command(p_update_id bigint,p_chat_id text,p_user_id text,p_command text,
  p_briefing text default null,p_idea_id uuid default null,p_product_url text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare prior public.telegram_commands; payload jsonb; output jsonb; cfg jsonb; niche_name text;
  idea public.idea_queue; inserted_id bigint; pending_count integer; max_pending integer; daily_cap integer;
begin
  if p_update_id is null or p_update_id<0 or p_chat_id is null or p_chat_id !~ '^-?[0-9]+$'
    or p_user_id is null or p_user_id !~ '^[1-9][0-9]*$'
    or p_command is null or p_command not in ('idea','queue','cancel') then
    raise check_violation using message='Invalid queue command identity'; end if;
  if p_command='idea' and (p_briefing is null or char_length(btrim(p_briefing)) not between 20 and 2000 or p_idea_id is not null) then
    raise check_violation using message='Briefing must contain 20 to 2000 characters'; end if;
  if p_command='cancel' and p_idea_id is null then raise check_violation using message='Idea ID required'; end if;
  if p_command<>'idea' and (p_briefing is not null or p_product_url is not null) then raise check_violation using message='Unexpected briefing'; end if;
  if p_command='queue' and p_idea_id is not null then raise check_violation using message='Unexpected idea ID'; end if;
  if p_product_url is not null and (char_length(p_product_url)>2048 or p_product_url !~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$') then
    raise check_violation using message='Affiliate URL must be HTTPS without credentials'; end if;
  payload:=jsonb_build_object('briefing',p_briefing,'idea_id',p_idea_id,'product_url',p_product_url);
  insert into public.telegram_commands(update_id,chat_id,user_id,command,request_payload)
    values(p_update_id,p_chat_id,p_user_id,p_command,payload) on conflict(update_id) do nothing returning update_id into inserted_id;
  if inserted_id is null then
    select * into prior from public.telegram_commands where update_id=p_update_id;
    if prior.chat_id is distinct from p_chat_id or prior.user_id is distinct from p_user_id
      or prior.command is distinct from p_command or prior.request_payload is distinct from payload then
      raise check_violation using message='Update replay payload mismatch'; end if;
    return jsonb_build_object('duplicate',true);
  end if;

  -- Serialize bot additions/cancellations; the existing consumer retains its row locks.
  perform pg_advisory_xact_lock(hashtext('content-ai-telegram-queue'));
  select value into cfg from public.system_config where key='telegram_queue';
  if p_command<>'queue' and (cfg is null or cfg->'enabled' is distinct from 'true'::jsonb) then
    output:=jsonb_build_object('code','disabled');
  elsif p_command='idea' then
    max_pending:=(cfg->>'max_pending')::integer;
    daily_cap:=(cfg->>'max_additions_per_day')::integer;
    select value->>'name' into niche_name from public.system_config where key='niche';
    if max_pending is null or max_pending not between 1 and 100 or daily_cap is null or daily_cap not between 1 and 100
      or nullif(btrim(niche_name),'') is null then raise check_violation using message='Invalid queue limits/niche'; end if;
    select count(*) into pending_count from public.idea_queue where status='pending';
    if pending_count>=max_pending then output:=jsonb_build_object('code','queue_full','limit',max_pending);
    elsif (select count(*) from public.telegram_commands where command='idea' and result->>'code'='created'
      and created_at>=(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'))>=daily_cap then
      output:=jsonb_build_object('code','daily_limit','limit',daily_cap);
    else
      insert into public.idea_queue(briefing,niche,product_url) values(btrim(p_briefing),niche_name,p_product_url) returning * into idea;
      output:=jsonb_build_object('code','created','idea_id',idea.id,'commercial',p_product_url is not null,
        'pipeline_enabled',exists(select 1 from public.system_config where key='pipeline' and value->'enabled'='true'::jsonb));
    end if;
  elsif p_command='cancel' then
    select * into idea from public.idea_queue where id=p_idea_id for update;
    if not found then output:=jsonb_build_object('code','not_found');
    elsif idea.status='consumed' then output:=jsonb_build_object('code','already_started','episode_id',idea.episode_id);
    elsif idea.status='rejected' then output:=jsonb_build_object('code','already_cancelled');
    else
      update public.idea_queue set status='rejected' where id=idea.id;
      output:=jsonb_build_object('code','cancelled','idea_id',idea.id);
    end if;
  else
    output:=jsonb_build_object('code','queue',
      'total_pending',(select count(*) from public.idea_queue where status='pending'),
      'pipeline_enabled',exists(select 1 from public.system_config where key='pipeline' and value->'enabled'='true'::jsonb),
      'items',coalesce((select jsonb_agg(to_jsonb(q)) from (
        select id,left(briefing,100) as briefing from public.idea_queue where status='pending' order by priority,created_at,id limit 10
      ) q),'[]'::jsonb),
      'recent',coalesce((select jsonb_agg(to_jsonb(q)) from (
        select i.episode_id,e.status from public.idea_queue i join public.episodes e on e.id=i.episode_id
        where i.status='consumed' order by i.consumed_at desc,i.id limit 3
      ) q),'[]'::jsonb));
  end if;
  update public.telegram_commands set result=output,reply_status='sending' where update_id=p_update_id;
  return output;
end $$;
revoke all on function public.telegram_queue_command(bigint,text,text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.telegram_queue_command(bigint,text,text,text,text,uuid,text) to service_role;
