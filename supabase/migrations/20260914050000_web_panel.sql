-- ADR-029: service-only administrative commands. Actor comes from verified Auth.
alter table public.idea_queue add column revision integer not null default 0;
create function public.idea_queue_revision() returns trigger language plpgsql as $$
begin new.revision:=old.revision+1; return new; end $$;
create trigger idea_queue_revision before update on public.idea_queue for each row execute function public.idea_queue_revision();

create table public.web_panel_commands (
  request_id uuid primary key, actor uuid not null, action text not null,
  payload jsonb not null, result jsonb, created_at timestamptz not null default now()
);
alter table public.web_panel_commands enable row level security;
grant select on public.web_panel_commands to service_role;

create function public.web_panel_mutation(p_request_id uuid,p_actor uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare prior public.web_panel_commands; inserted uuid; idea public.idea_queue; cfg public.system_config;
  output jsonb; limits jsonb; max_pending int; daily_cap int; niche_name text; priority_value int;
begin
  if p_request_id is null or p_actor is null or p_action is null or p_action not in ('add','edit','cancel','pipeline','niche')
    or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>12000 then
    raise check_violation using message='Invalid administrative command'; end if;
  insert into public.web_panel_commands(request_id,actor,action,payload) values(p_request_id,p_actor,p_action,p_payload)
    on conflict(request_id) do nothing returning request_id into inserted;
  if inserted is null then
    select * into prior from public.web_panel_commands where request_id=p_request_id;
    if prior.actor<>p_actor or prior.action<>p_action or prior.payload<>p_payload then
      raise check_violation using message='Replay payload mismatch'; end if;
    return prior.result;
  end if;

  if p_action in ('add','edit','cancel') then
    perform pg_advisory_xact_lock(hashtext('content-ai-telegram-queue'));
    if p_action in ('add','edit') then
      priority_value:=(p_payload->>'priority')::int;
      if jsonb_typeof(p_payload->'briefing') is distinct from 'string' or char_length(btrim(p_payload->>'briefing')) not between 20 and 2000
        or priority_value is null or priority_value not between 1 and 1000 then raise check_violation using message='Invalid briefing/priority'; end if;
      if p_payload->>'product_url' is not null and (char_length(p_payload->>'product_url')>2048
        or p_payload->>'product_url' !~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$') then
        raise check_violation using message='Invalid product URL'; end if;
    end if;
    if p_action='add' then
      select value into limits from public.system_config where key='telegram_queue';
      max_pending:=(limits->>'max_pending')::int; daily_cap:=(limits->>'max_additions_per_day')::int;
      select value->>'name' into niche_name from public.system_config where key='niche';
      if limits->'enabled' is distinct from 'true'::jsonb then output:='{"code":"disabled"}';
      elsif max_pending is null or max_pending not between 1 and 100 or daily_cap is null or daily_cap not between 1 and 100
        or nullif(btrim(niche_name),'') is null then raise check_violation using message='Invalid queue configuration';
      elsif (select count(*) from public.idea_queue where status='pending')>=max_pending then output:='{"code":"queue_full"}';
      elsif (select count(*) from public.idea_queue where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=daily_cap then output:='{"code":"daily_limit"}';
      else
        insert into public.idea_queue(briefing,niche,product_url,priority) values(btrim(p_payload->>'briefing'),niche_name,p_payload->>'product_url',priority_value) returning * into idea;
        output:=jsonb_build_object('code','created','idea_id',idea.id);
      end if;
    else
      select * into idea from public.idea_queue where id=(p_payload->>'id')::uuid for update;
      if not found then output:='{"code":"not_found"}';
      elsif idea.status<>'pending' then output:='{"code":"already_started"}';
      elsif idea.revision is distinct from (p_payload->>'revision')::int then output:='{"code":"conflict"}';
      elsif p_action='cancel' then
        update public.idea_queue set status='rejected' where id=idea.id;
        output:=jsonb_build_object('code','cancelled','idea_id',idea.id);
      else
        update public.idea_queue set briefing=btrim(p_payload->>'briefing'),product_url=p_payload->>'product_url',priority=priority_value where id=idea.id;
        output:=jsonb_build_object('code','updated','idea_id',idea.id);
      end if;
    end if;
  else
    select * into cfg from public.system_config where key=p_action for update;
    if not found then output:='{"code":"not_found"}';
    elsif cfg.updated_at is distinct from (p_payload->>'revision')::timestamptz then output:='{"code":"conflict"}';
    else
      if p_action='pipeline' then
        if jsonb_typeof(p_payload->'enabled') is distinct from 'boolean' or (p_payload->>'max_episodes_per_day')::int is null
          or (p_payload->>'max_episodes_per_day')::int not between 1 and 10 then raise check_violation using message='Invalid pipeline settings'; end if;
        update public.system_config set value=value || jsonb_build_object('enabled',p_payload->'enabled',
          'max_episodes_per_day',(p_payload->>'max_episodes_per_day')::int,'require_human_approval',true,'auto_publish',false) where key=p_action;
      else
        if jsonb_typeof(p_payload->'focus') is distinct from 'string' or char_length(btrim(p_payload->>'focus')) not between 10 and 500 then raise check_violation using message='Invalid editorial focus'; end if;
        update public.system_config set value=value || jsonb_build_object('focus',btrim(p_payload->>'focus')) where key=p_action;
      end if;
      output:=jsonb_build_object('code','saved','key',p_action);
    end if;
  end if;
  update public.web_panel_commands set result=output where request_id=p_request_id;
  return output;
end $$;
revoke all on function public.web_panel_mutation(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.web_panel_mutation(uuid,uuid,text,jsonb) to service_role;
