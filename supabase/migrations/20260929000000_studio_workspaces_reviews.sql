-- ADR-042/043: isolated workspaces and one review decision ledger for web/Telegram.
create table public.studio_workspaces (
  id uuid primary key default gen_random_uuid(), name text not null check(char_length(name) between 2 and 100),
  settings jsonb not null default '{"pipeline":{"enabled":false,"max_episodes_per_day":1},"niche":{"name":"geek","focus":"Notícias verificadas de cultura geek"},"discovery":{"enabled":false,"theme":"geek"}}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
insert into public.studio_workspaces(id,name) values('00000000-0000-4000-8000-000000000001','Fritz Inova');
create table public.studio_members (
  user_id uuid primary key, workspace_id uuid not null references public.studio_workspaces(id),
  role text not null default 'owner' check(role in ('owner','editor')), created_at timestamptz not null default now()
);
-- Use an explicit cast of the JWT subject, not any workspace identifier supplied by the browser.
create or replace function public.studio_actor_workspace() returns uuid language sql stable security definer set search_path=public,pg_temp as $$
  select workspace_id from public.studio_members where user_id=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
$$;
create function public.studio_assert_member(p_workspace uuid,p_actor uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_actor is null or not exists(select 1 from public.studio_members where user_id=p_actor and workspace_id=p_workspace) then
    raise insufficient_privilege using message='Workspace access denied'; end if;
end $$;
create function public.studio_provision(p_actor uuid,p_name text,p_legacy boolean default false) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare w uuid;
begin
  if p_actor is null then raise check_violation using message='Actor required'; end if;
  perform pg_advisory_xact_lock(hashtext(p_actor::text));
  select workspace_id into w from public.studio_members where user_id=p_actor;
  if w is not null then return w; end if;
  if p_legacy then w:='00000000-0000-4000-8000-000000000001';
  else
    perform pg_advisory_xact_lock(hashtext('studio-provision-cap'));
    if (select count(*) from public.studio_workspaces)>=10 then raise check_violation using message='Workspace free-tier capacity reached';end if;
    insert into public.studio_workspaces(name) values(left(coalesce(nullif(btrim(p_name),''),'Meu Studio'),100)) returning id into w; end if;
  insert into public.studio_members(user_id,workspace_id) values(p_actor,w);
  return w;
end $$;
alter table public.studio_workspaces enable row level security;
alter table public.studio_members enable row level security;
create policy own_workspace on public.studio_workspaces for select to authenticated using(id=public.studio_actor_workspace());
create policy own_membership on public.studio_members for select to authenticated using(workspace_id=public.studio_actor_workspace());
grant select on public.studio_workspaces,public.studio_members to authenticated;
grant all on public.studio_workspaces,public.studio_members to service_role;

do $$ declare tab text; begin
  foreach tab in array array['idea_queue','episodes','assets','publishes','job_events','review_requests','web_panel_commands'] loop
    execute format('alter table public.%I add column workspace_id uuid not null default ''00000000-0000-4000-8000-000000000001'' references public.studio_workspaces(id)',tab);
    execute format('create index on public.%I(workspace_id)',tab);
    execute format('create policy studio_read on public.%I for select to authenticated using(workspace_id=public.studio_actor_workspace())',tab);
    execute format('grant select on public.%I to authenticated',tab);
  end loop;
end $$;
create function public.studio_child_workspace() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare w uuid;
begin
  if TG_OP='UPDATE' and new.workspace_id<>old.workspace_id then raise check_violation using message='Workspace immutable'; end if;
  if new.episode_id is not null then
    select workspace_id into strict w from public.episodes where id=new.episode_id;
    if TG_OP='INSERT' then new.workspace_id:=w;
    elsif new.workspace_id<>w then raise check_violation using message='Cross-workspace episode'; end if;
  end if;
  return new;
end $$;
do $$ declare tab text; begin
  foreach tab in array array['idea_queue','assets','publishes','job_events','review_requests'] loop
    execute format('create trigger studio_workspace before insert or update on public.%I for each row execute function public.studio_child_workspace()',tab);
  end loop;
end $$;
-- Preserve existing approval fingerprints: tenancy metadata is not editorial content.
create or replace function public.review_snapshot(ep public.episodes) returns jsonb language sql stable set search_path=public,pg_temp as $$
  select jsonb_build_object('episode',jsonb_build_object('id',ep.id,'script_hash',ep.script_hash,'script_json',ep.script_json,'render_url',ep.render_url,'research_data',ep.research_data,'research_evidence',ep.research_evidence,'product_compliance',ep.product_compliance,'metadata',jsonb_build_object('render_outputs',ep.metadata->'render_outputs','render_generation',ep.metadata->'render_generation')),
  'assets',coalesce((select jsonb_agg(to_jsonb(a)-'created_at'-'workspace_id' order by a.id) from public.assets a where a.episode_id=ep.id),'[]'::jsonb),
  'fact_check',(select value from public.system_config where key='fact_check'));
$$;
alter table public.review_requests alter column chat_id drop not null, alter column user_id drop not null;
alter table public.review_requests drop constraint review_requests_delivery_status_check;
alter table public.review_requests add constraint review_requests_delivery_status_check check(delivery_status in ('not_requested','sending','sent','uncertain','failed'));
alter table public.review_requests add column decision_origin text check(decision_origin in ('web','telegram'));
alter table public.idea_queue add column editorial_profile jsonb;

create table public.studio_channels (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.studio_workspaces(id),
  external_id text not null, platform text not null check(platform in ('youtube','tiktok')), name text not null,
  enabled boolean not null default false, timezone text not null default 'America/Sao_Paulo',
  updated_at timestamptz not null default now(), unique(workspace_id,external_id)
);
create table public.studio_connections (
  workspace_id uuid not null references public.studio_workspaces(id), provider text not null check(provider in ('buffer','telegram')),
  secret_id uuid, status text not null default 'disconnected' check(status in ('connected','disconnected','reconnect','pending')),
  metadata jsonb not null default '{}', updated_at timestamptz not null default now(), primary key(workspace_id,provider)
);
create table public.studio_usage (
  workspace_id uuid not null references public.studio_workspaces(id), kind text not null,
  period date not null default (now() at time zone 'UTC')::date, used int not null default 0, primary key(workspace_id,kind,period)
);
create table public.studio_oauth_states (
  state_hash text primary key, workspace_id uuid not null references public.studio_workspaces(id), actor uuid not null,
  verifier text not null, expires_at timestamptz not null, created_at timestamptz not null default now()
);
create table public.studio_outbox (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.studio_workspaces(id),
  episode_id uuid not null references public.episodes(id), review_id uuid not null references public.review_requests(id),
  channel_id uuid not null references public.studio_channels(id), fingerprint text not null,
  due_at timestamptz, status text not null default 'pending' check(status in ('pending','sending','scheduled','published','failed','uncertain')),
  external_id text, error_code text, updated_at timestamptz not null default now(), created_at timestamptz not null default now(),
  unique(episode_id,channel_id,fingerprint)
);
create table public.studio_telegram_links (
  code_hash text primary key, workspace_id uuid not null references public.studio_workspaces(id), actor uuid not null,
  expires_at timestamptz not null, created_at timestamptz not null default now()
);
do $$ declare tab text; begin
  foreach tab in array array['studio_channels','studio_connections','studio_usage','studio_oauth_states','studio_outbox','studio_telegram_links'] loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('grant all on public.%I to service_role',tab);
  end loop;
end $$;
create function public.studio_reserve_usage(p_workspace uuid,p_kind text,p_limit int) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare n int;
begin
  if p_limit<1 or p_limit>100 or p_kind not in ('discovery','help','generation') then raise check_violation using message='Invalid usage'; end if;
  insert into public.studio_usage(workspace_id,kind,used) values(p_workspace,p_kind,1)
    on conflict(workspace_id,kind,period) do update set used=studio_usage.used+1 where studio_usage.used<p_limit returning used into n;
  return n is not null;
end $$;
-- Secrets live only in Vault. Dynamic SQL keeps disposable CI independent of the extension.
create function public.studio_store_secret(p_workspace uuid,p_provider text,p_value jsonb,p_metadata jsonb default '{}') returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare sid uuid;
begin
  if p_provider not in ('buffer','telegram') then raise check_violation using message='Invalid connection'; end if;
  perform pg_advisory_xact_lock(hashtext(p_workspace::text||p_provider));
  select secret_id into sid from public.studio_connections where workspace_id=p_workspace and provider=p_provider for update;
  if sid is null then execute 'select vault.create_secret($1)' into sid using p_value::text;
  else execute 'select vault.update_secret($1,$2)' using sid,p_value::text; end if;
  insert into public.studio_connections(workspace_id,provider,secret_id,status,metadata) values(p_workspace,p_provider,sid,'connected',p_metadata)
  on conflict(workspace_id,provider) do update set secret_id=excluded.secret_id,status='connected',metadata=excluded.metadata,updated_at=now();
end $$;
create function public.studio_read_secret(p_workspace uuid,p_provider text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare sid uuid; result jsonb;
begin
  select secret_id into sid from public.studio_connections where workspace_id=p_workspace and provider=p_provider and status='connected';
  if sid is null then return null; end if;
  execute 'select decrypted_secret::jsonb from vault.decrypted_secrets where id=$1' into result using sid;
  return result;
end $$;
create function public.studio_ensure_review(p_episode uuid) returns public.review_requests language plpgsql security definer set search_path=public,pg_temp as $$
declare ep public.episodes; req public.review_requests; fp text;
begin
  select * into ep from public.episodes where id=p_episode for update;
  if not found or ep.status<>'review' or ep.render_url is null then return null; end if;
  fp:=public.review_fingerprint(ep);
  select * into req from public.review_requests where episode_id=ep.id and fingerprint=fp and decision in ('pending','approved','rejected') order by created_at desc limit 1;
  if found then return req; end if;
  update public.review_requests set decision='superseded' where episode_id=ep.id and decision in ('pending','approved');
  update public.episodes set approval_user=null,approval_date=null,approval_fingerprint=null where id=ep.id;
  insert into public.review_requests(episode_id,fingerprint,snapshot,delivery_status) values(ep.id,fp,public.review_snapshot(ep),'not_requested') returning * into req;
  return req;
end $$;
create or replace function public.prepare_review(p_chat_id text,p_user_id text,p_episode_id uuid default null,p_force boolean default false)
returns public.review_requests language plpgsql security definer set search_path=public,pg_temp as $$
declare ep public.episodes; req public.review_requests;
begin
  if p_chat_id is null or p_user_id is null or p_chat_id !~ '^-?[0-9]+$' or p_user_id !~ '^[1-9][0-9]*$' then raise check_violation using message='Invalid Telegram identity'; end if;
  if p_force and p_episode_id is null then raise check_violation using message='Force requires episode'; end if;
  select * into ep from public.episodes e where e.workspace_id='00000000-0000-4000-8000-000000000001' and e.status='review'
    and (p_episode_id is null or e.id=p_episode_id)
    and (p_force or not exists(select 1 from public.review_requests r where r.episode_id=e.id and r.fingerprint=public.review_fingerprint(e) and (r.delivery_status<>'not_requested' or r.decision<>'pending')))
    order by e.created_at limit 1 for update skip locked;
  if not found then return null; end if;
  if p_force then
    update public.review_requests set decision='superseded' where episode_id=ep.id and decision in ('pending','approved','rejected');
    update public.episodes set approval_user=null,approval_date=null,approval_fingerprint=null where id=ep.id;
  end if;
  req:=public.studio_ensure_review(ep.id);
  update public.review_requests set chat_id=p_chat_id,user_id=p_user_id,delivery_status='sending',message_id=null where id=req.id returning * into req;
  return req;
end $$;

create function public.studio_review_action(p_workspace uuid,p_actor uuid,p_request uuid,p_review uuid,p_fingerprint text,p_action text,p_channels uuid[] default '{}',p_due_at timestamptz default null,p_instructions text default null,p_platforms text[] default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare req public.review_requests; ep public.episodes; prior public.web_panel_commands; result jsonb; payload jsonb; stamp timestamptz:=clock_timestamp(); next_id uuid; c public.studio_channels; cfg jsonb;
begin
  perform public.studio_assert_member(p_workspace,p_actor);
  perform pg_advisory_xact_lock(hashtext('content-ai-daily-cap'));
  perform pg_advisory_xact_lock(hashtext('studio-command-'||p_workspace));
  if p_action not in ('approve','reject','adjust','rerender') then raise check_violation using message='Invalid review action'; end if;
  payload:=jsonb_build_object('review',p_review,'fingerprint',p_fingerprint,'action',p_action,'channels',p_channels,'due_at',p_due_at,'instructions',p_instructions,'platforms',p_platforms);
  perform pg_advisory_xact_lock(hashtext(p_request::text));
  select * into prior from public.web_panel_commands where request_id=p_request;
  if found then
    if prior.actor<>p_actor or prior.workspace_id<>p_workspace or prior.payload<>payload then raise insufficient_privilege; end if;
    return prior.result;
  end if;
  select * into ep from public.episodes where id=(select episode_id from public.review_requests where id=p_review and workspace_id=p_workspace) for update;
  select * into req from public.review_requests where id=p_review and workspace_id=p_workspace for update;
  if not found then raise insufficient_privilege using message='Review unavailable'; end if;
  if ep.status<>'review' or req.decision not in ('pending','approved') or req.fingerprint<>p_fingerprint or req.fingerprint<>public.review_fingerprint(ep) then return '{"code":"stale"}'; end if;
  if p_action<>'approve' and (exists(select 1 from public.publishes where episode_id=ep.id and status in ('processing','published')) or exists(select 1 from public.studio_outbox where episode_id=ep.id and status in ('sending','scheduled','published','uncertain'))) then return '{"code":"already_scheduled"}'; end if;
  if p_action='approve' then
    if p_due_at is not null and (p_due_at<=now() or p_due_at>now()+interval '90 days') then raise check_violation using message='Invalid publication date'; end if;
    if cardinality(p_channels)>10 or cardinality(p_platforms)>2 then raise check_violation; end if;
    if cardinality(p_platforms)>0 then
      if p_workspace<>'00000000-0000-4000-8000-000000000001' or not p_platforms<@array['youtube','tiktok'] then raise insufficient_privilege; end if;
      if 'tiktok'=any(p_platforms) and not exists(select 1 from public.system_config where key='buffer_tiktok' and value->>'enabled'='true') then return '{"code":"channel_unavailable"}'; end if;
      if 'youtube'=any(p_platforms) and not exists(select 1 from public.system_config where key='buffer_youtube' and value->>'enabled'='true') then return '{"code":"channel_unavailable"}'; end if;
    end if;
    foreach next_id in array p_channels loop
      select * into c from public.studio_channels where id=next_id and workspace_id=p_workspace and enabled;
      if not found then raise insufficient_privilege using message='Channel unavailable'; end if;
      insert into public.studio_outbox(workspace_id,episode_id,review_id,channel_id,fingerprint,due_at)
        values(p_workspace,ep.id,req.id,c.id,req.fingerprint,p_due_at) on conflict do nothing;
    end loop;
    update public.review_requests set decision='approved',decided_at=stamp,user_id=p_actor::text,decision_origin='web',
      buffer_tiktok_consent=coalesce(buffer_tiktok_consent,false) and decision='approved' or 'tiktok'=any(p_platforms),
      buffer_youtube_consent=coalesce(buffer_youtube_consent,false) and decision='approved' or 'youtube'=any(p_platforms),
      youtube_public_consent=false where id=req.id;
    update public.episodes set approval_user=p_actor::text,approval_date=stamp,approval_fingerprint=req.fingerprint where id=ep.id;
    result:='{"code":"approved"}';
  elsif p_action='adjust' then
    if char_length(btrim(coalesce(p_instructions,''))) not between 10 and 2000 then raise check_violation using message='Adjustment instructions required'; end if;
    if (select count(*) from public.episodes where workspace_id=p_workspace and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=1 or not public.studio_reserve_usage(p_workspace,'generation',1) then return '{"code":"daily_cap_reached"}'; end if;
    insert into public.episodes(workspace_id,status,briefing,product_compliance,product_image_url)
      values(p_workspace,'idea',ep.briefing||jsonb_build_object('text',left(ep.briefing->>'text',5000)||E'\nAjuste solicitado pelo operador: '||p_instructions,'previous_episode_id',ep.id),ep.product_compliance,ep.product_image_url) returning id into next_id;
    update public.review_requests set decision='superseded',decided_at=stamp,decision_origin='web' where id=req.id;
    update public.episodes set status='failed',failure_reason='adjustment_requested' where id=ep.id;
    result:=jsonb_build_object('code','adjustment_started','episode_id',next_id);
  else
    update public.review_requests set decision='rejected',decided_at=stamp,decision_origin='web' where id=req.id;
    update public.episodes set status=case p_action when 'rerender' then 'assets' else 'failed' end,
      failure_reason=case p_action when 'reject' then 'human_review_rejected' else null end where id=ep.id;
    result:=jsonb_build_object('code',case p_action when 'rerender' then 'rerender_requested' else 'rejected' end);
  end if;
  insert into public.job_events(episode_id,event_type,metadata) values(ep.id,case p_action when 'approve' then 'approval_received' else 'approval_rejected' end,jsonb_build_object('origin','web','actor',p_actor,'action',p_action,'request_id',p_request));
  insert into public.web_panel_commands(request_id,actor,action,payload,result,workspace_id) values(p_request,p_actor,'review_'||p_action,payload,result,p_workspace);
  return result;
end $$;

-- Only trusted server routes can provision identities, read secrets or mutate state.
do $$ declare fn record; begin
 for fn in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'studio_%' loop
   execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
   execute format('grant execute on function %s to service_role',fn.signature);
 end loop;
end $$;
grant execute on function public.studio_actor_workspace() to authenticated;
insert into public.system_config(key,value) values('studio_public','{"enabled":false}') on conflict do nothing;

create or replace function public.consume_idea_unchecked(p_idea_id uuid)
returns table(episode_id uuid, idea_id uuid) language plpgsql set search_path=public,pg_temp as $$
#variable_conflict use_column
declare v_idea public.idea_queue%rowtype; v_episode_id uuid; v_links jsonb;
  v_legacy_platform text; v_compliance jsonb;
begin
  select * into v_idea from public.idea_queue where id=p_idea_id and status='pending' for update;
  if not found then return; end if;
  if v_idea.source='trend_discovery' and (v_idea.validated_at is null
      or v_idea.generation_requested_at is null
      or v_idea.selected_product is null or v_idea.selected_hook is null
      or v_idea.selected_evidence_url is null) then return; end if;
  v_links:=coalesce(v_idea.affiliate_links,'{}'::jsonb);
  if v_links='{}'::jsonb and v_idea.product_url is not null then
    select value->>'legacy_product_url_platform' into v_legacy_platform
      from public.system_config where key='affiliate_monetization';
    v_legacy_platform:=coalesce(v_legacy_platform,'youtube');
    if v_legacy_platform not in ('youtube','tiktok') then
      raise check_violation using message='Invalid legacy affiliate platform';
    end if;
    v_links:=jsonb_build_object(v_legacy_platform,v_idea.product_url);
  end if;
  v_compliance:=case when v_links<>'{}'::jsonb then
    jsonb_build_object('affiliate_links',v_links,'commercial_content',true)
      || case when v_links ? 'youtube'
        then jsonb_build_object('affiliate_link',v_links->>'youtube')
        else '{}'::jsonb end
    else null end;
  insert into public.episodes(workspace_id,status,briefing,product_compliance,product_image_url)
  values(v_idea.workspace_id,'idea',jsonb_build_object(
    'editorial_profile',v_idea.editorial_profile,'text',v_idea.briefing,'niche',v_idea.niche,'category',v_idea.category,
    'idea_id',v_idea.id,'product_name',v_idea.selected_product,
    'evidence_url',v_idea.selected_evidence_url
  ),v_compliance,v_idea.product_image_url) returning id into v_episode_id;
  update public.idea_queue set status='consumed',consumed_at=now(),episode_id=v_episode_id
    where id=v_idea.id;
  return query select v_episode_id,v_idea.id;
end $$;
revoke all on function public.consume_idea_unchecked(uuid) from public,anon,authenticated,service_role;

create or replace function public.consume_next_idea_unchecked()
returns table(episode_id uuid, idea_id uuid) language plpgsql set search_path=public,pg_temp as $$
#variable_conflict use_column
declare v_id uuid;
begin
  select id into v_id from public.idea_queue
    where workspace_id='00000000-0000-4000-8000-000000000001' and status='pending' and (source<>'trend_discovery' or
      (validated_at is not null and generation_requested_at is not null
       and selected_product is not null
       and selected_hook is not null and selected_evidence_url is not null))
    order by priority,created_at,id limit 1 for update skip locked;
  if v_id is null then return; end if;
  return query select * from public.consume_idea_unchecked(v_id);
end $$;
revoke all on function public.consume_next_idea_unchecked() from public,anon,authenticated,service_role;

-- Trust boundary for every panel mutation; legacy RPCs remain internal implementation details.
create function public.studio_command(p_workspace uuid,p_actor uuid,p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare idea public.idea_queue; ep uuid; result jsonb; prior public.web_panel_commands; w public.studio_workspaces; cap int; profile jsonb;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform pg_advisory_xact_lock(hashtext('content-ai-daily-cap'));
 perform pg_advisory_xact_lock(hashtext('studio-command-'||p_workspace));
 perform pg_advisory_xact_lock(hashtext(p_request::text));
 select * into prior from public.web_panel_commands where request_id=p_request;
 if found then
   if prior.actor<>p_actor or prior.workspace_id<>p_workspace or prior.action<>p_action or prior.payload<>p_payload then raise insufficient_privilege; end if;
   return prior.result;
 end if;
 if p_action in ('edit','cancel','choose_product','generate_video') then
   select * into idea from public.idea_queue where id=(p_payload->>'id')::uuid and workspace_id=p_workspace for update;
   if not found then raise insufficient_privilege using message='Idea unavailable'; end if;
 end if;
 if p_workspace='00000000-0000-4000-8000-000000000001' and p_action not in ('editorial','candidate') and not (p_action='generate_video' and idea.source<>'trend_discovery') then
   if p_action in ('choose_product','generate_video') then
     return public.web_panel_candidate_action(p_request,p_actor,p_action,p_payload);
   end if;
   return public.web_panel_mutation(p_request,p_actor,p_action,p_payload);
 end if;
 select * into strict w from public.studio_workspaces where id=p_workspace for update;
 if w.id='00000000-0000-4000-8000-000000000001' then
   w.settings:=jsonb_set(w.settings,'{pipeline}',(select value from public.system_config where key='pipeline'));
 end if;
 if p_action='editorial' then
   if p_payload->>'theme' not in ('gadgets','geek','novelas','finance','casa','games','ciencia') or char_length(coalesce(p_payload->>'focus',''))>500 then raise check_violation; end if;
   update public.studio_workspaces set settings=jsonb_set(settings,'{editorial}',p_payload),updated_at=now() where id=w.id;
   if w.id='00000000-0000-4000-8000-000000000001' then
     update public.system_config set value=value||'{"enabled":false}' where key='trend_discovery';
   end if;
   result:='{"code":"saved"}';
 elsif p_action in ('candidate','add') then
   if char_length(coalesce(p_payload->>'briefing','')) not between 20 and 2000 then raise check_violation; end if;
   if (select count(*) from public.idea_queue where workspace_id=w.id and status='pending')>=30 then return '{"code":"queue_full"}'; end if;
   if (select count(*) from public.idea_queue where workspace_id=w.id and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=10 then return '{"code":"daily_limit"}'; end if;
   profile:=coalesce(w.settings->'editorial','{"theme":"gadgets"}');
   if p_action='candidate' then
     if not exists(select 1 from public.studio_discoveries where workspace_id=w.id and id=(p_payload->>'discovery_id')::uuid and expires_at>now() and candidates @> jsonb_build_array(p_payload->'candidate')) then raise check_violation using message='Candidate must come from verified discovery'; end if;
     select d.profile into profile from public.studio_discoveries d where id=(p_payload->>'discovery_id')::uuid and workspace_id=w.id;
     select * into idea from public.idea_queue where workspace_id=w.id and selected_product=p_payload#>>'{candidate,title}' and selected_evidence_url=p_payload#>>'{candidate,source_url}' and status in ('pending','consumed') limit 1;
     if found then return jsonb_build_object('code','created','idea_id',idea.id); end if;
   end if;
   insert into public.idea_queue(workspace_id,briefing,niche,priority,source,editorial_profile,selected_product,selected_hook,selected_evidence_url,recommendations)
   values(w.id,p_payload->>'briefing',coalesce(profile->>'theme','gadgets'),500,case when p_action='candidate' then 'trend_discovery' else 'manual' end,profile,
     case when p_action='candidate' then p_payload#>>'{candidate,title}' end,
     case when p_action='candidate' then p_payload#>>'{candidate,hook}' end,
     case when p_action='candidate' then p_payload#>>'{candidate,source_url}' end,'[]') returning * into idea;
   result:=jsonb_build_object('code','created','idea_id',idea.id);
 elsif p_action='pipeline' then
   if jsonb_typeof(p_payload->'enabled')<>'boolean' or (p_payload->>'max_episodes_per_day')::int not between 1 and 3 then raise check_violation; end if;
   update public.studio_workspaces set settings=jsonb_set(settings,'{pipeline}',jsonb_build_object('enabled',p_payload->'enabled','max_episodes_per_day',(p_payload->>'max_episodes_per_day')::int,'require_human_approval',true)),updated_at=now() where id=w.id;
   result:='{"code":"saved"}';
 elsif p_action='niche' then
   if char_length(coalesce(p_payload->>'focus','')) not between 10 and 500 then raise check_violation; end if;
   update public.studio_workspaces set settings=jsonb_set(settings,'{niche,focus}',p_payload->'focus'),updated_at=now() where id=w.id;
   result:='{"code":"saved"}';
 elsif idea.status<>'pending' then result:='{"code":"already_started"}';
 elsif idea.revision is distinct from (p_payload->>'revision')::int then result:='{"code":"conflict"}';
 elsif p_action='cancel' then
   update public.idea_queue set status='rejected' where id=idea.id;
   result:='{"code":"cancelled"}';
 elsif p_action='edit' then
   if char_length(coalesce(p_payload->>'briefing','')) not between 20 and 2000 then raise check_violation; end if;
   update public.idea_queue set briefing=p_payload->>'briefing',validated_at=null where id=idea.id;
   result:='{"code":"updated"}';
 elsif p_action='choose_product' then
   profile:=idea.recommendations->(p_payload->>'index')::int;
   if profile is null or char_length(coalesce(profile->>'product_name','')) not between 8 and 160 then raise check_violation;end if;
   update public.idea_queue set briefing=left(format('Assunto específico: %s. Gancho: %s. Problema: %s. Limitação: %s. Fonte: %s. Vídeo com imagens licenciadas e CTA orgânico.',profile->>'product_name',profile->>'hook',profile->>'problem',profile->>'limitation',profile->>'source_url'),2000),selected_product=profile->>'product_name',selected_hook=profile->>'hook',selected_evidence_url=profile->>'source_url',validated_at=null where id=idea.id;
   result:='{"code":"product_chosen"}';
 elsif p_action='generate_video' then
   if w.settings#>>'{pipeline,enabled}' is distinct from 'true' then return '{"code":"pipeline_paused"}'; end if;
   if idea.source='trend_discovery' and (idea.selected_product is null or idea.selected_hook is null or idea.selected_evidence_url is null) then return '{"code":"product_required"}'; end if;
   if exists(select 1 from public.episodes where workspace_id=w.id and status in ('idea','research','script','assets','rendered')) then return '{"code":"production_busy"}'; end if;
   cap:=least(3,greatest(1,(w.settings#>>'{pipeline,max_episodes_per_day}')::int));
   if (select count(*) from public.episodes where workspace_id=w.id and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=cap then return '{"code":"daily_cap_reached"}'; end if;
   update public.idea_queue set validated_at=now(),generation_requested_at=now() where id=idea.id;
   select episode_id into ep from public.consume_idea_unchecked(idea.id);
   if ep is null then raise check_violation; end if;
   result:=jsonb_build_object('code','started','episode_id',ep,'idea_id',idea.id);
 else raise check_violation using message='Unsupported command'; end if;
 insert into public.web_panel_commands(workspace_id,request_id,actor,action,payload,result) values(w.id,p_request,p_actor,p_action,p_payload,result);
 return result;
end $$;
create table public.studio_discoveries (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.studio_workspaces(id),
 profile jsonb not null,candidates jsonb not null,created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '24 hours'
);
alter table public.studio_discoveries enable row level security;
grant all on public.studio_discoveries to service_role;
revoke all on function public.studio_command(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.studio_command(uuid,uuid,uuid,text,jsonb) to service_role;
-- Refresh claims are durable. An expired/ambiguous token rotation requires reconnect,
-- never a second request with a single-use refresh token.
alter table public.studio_connections add column refresh_claimed_at timestamptz;
create function public.studio_claim_refresh(p_workspace uuid) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare n int;
begin
 update public.studio_connections set refresh_claimed_at=now() where workspace_id=p_workspace and provider='buffer' and status='connected' and refresh_claimed_at is null;
 get diagnostics n=row_count;return n=1;
end $$;
create function public.studio_link_telegram(p_hash text,p_chat text,p_user text,p_workspace uuid default null) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare link public.studio_telegram_links;
begin
 delete from public.studio_telegram_links where code_hash=p_hash and expires_at>now() and (p_workspace is null or workspace_id=p_workspace) returning * into link;
 if not found then return false;end if;
 perform public.studio_assert_member(link.workspace_id,link.actor);
 if p_chat<>p_user or p_user !~ '^[1-9][0-9]*$' then raise check_violation;end if;
 insert into public.studio_connections(workspace_id,provider,status,metadata) values(link.workspace_id,'telegram','connected',jsonb_build_object('chat_id',p_chat,'user_id',p_user,'mode','shared'))
 on conflict(workspace_id,provider) do update set status='connected',metadata=studio_connections.metadata||jsonb_build_object('chat_id',p_chat,'user_id',p_user),updated_at=now();
 return true;
end $$;
create table public.studio_notifications(review_id uuid primary key references public.review_requests(id),workspace_id uuid not null references public.studio_workspaces(id),status text not null default 'sending',created_at timestamptz not null default now());
alter table public.studio_notifications enable row level security;
grant all on public.studio_notifications to service_role;
revoke all on function public.studio_claim_refresh(uuid),public.studio_link_telegram(text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.studio_claim_refresh(uuid),public.studio_link_telegram(text,text,text,uuid) to service_role;
insert into storage.buckets(id,name,public,file_size_limit) values('studio-private','studio-private',false,52428800),('studio-published','studio-published',true,52428800) on conflict(id) do nothing;
-- Outbox foreign keys cannot join an episode, review or channel from another workspace.
alter table public.episodes add constraint episodes_workspace_unique unique(id,workspace_id);
alter table public.review_requests add constraint reviews_workspace_unique unique(id,workspace_id);
alter table public.studio_channels add constraint channels_workspace_unique unique(id,workspace_id);
alter table public.studio_outbox add foreign key(episode_id,workspace_id) references public.episodes(id,workspace_id), add foreign key(review_id,workspace_id) references public.review_requests(id,workspace_id),add foreign key(channel_id,workspace_id) references public.studio_channels(id,workspace_id);
create function public.studio_claim_post() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare o public.studio_outbox;ep public.episodes;r public.review_requests;c public.studio_channels;
begin
 select * into o from public.studio_outbox where status='pending' order by created_at limit 1 for update skip locked;
 if not found then return null;end if;
 select * into ep from public.episodes where id=o.episode_id for update;
 select * into r from public.review_requests where id=o.review_id;
 select * into c from public.studio_channels where id=o.channel_id;
 if ep.status<>'review' or r.episode_id<>ep.id or r.decision<>'approved' or r.fingerprint<>o.fingerprint or public.review_fingerprint(ep)<>o.fingerprint or ep.approval_fingerprint is distinct from o.fingerprint or not c.enabled or not exists(select 1 from public.studio_connections where workspace_id=o.workspace_id and provider='buffer' and status='connected') then
   update public.studio_outbox set status='failed',error_code='APPROVAL_OR_CONNECTION_CHANGED',updated_at=now() where id=o.id;return null;
 end if;
 update public.studio_outbox set status='sending',updated_at=now() where id=o.id;
 return jsonb_build_object('outbox',to_jsonb(o),'snapshot',r.snapshot,'channel',to_jsonb(c));
end $$;
revoke all on function public.studio_claim_post() from public,anon,authenticated;
grant execute on function public.studio_claim_post() to service_role;
create function public.studio_claim_discovery() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare w public.studio_workspaces;actor uuid;
begin
 select * into w from public.studio_workspaces where settings#>>'{editorial,auto_discover}'='true'
   and coalesce((settings->>'last_discovery_day'),'')<>(now() at time zone 'UTC')::date::text
   order by updated_at limit 1 for update skip locked;
 if not found then return null;end if;
 select user_id into actor from public.studio_members where workspace_id=w.id and role='owner' order by created_at limit 1;
 if actor is null then return null;end if;
 update public.studio_workspaces set settings=settings||jsonb_build_object('last_discovery_day',(now() at time zone 'UTC')::date::text) where id=w.id;
 return jsonb_build_object('workspace',w.id,'actor',actor,'profile',w.settings->'editorial');
end $$;
revoke all on function public.studio_claim_discovery() from public,anon,authenticated;
grant execute on function public.studio_claim_discovery() to service_role;
create function public.studio_next_episode() returns setof public.episodes language sql stable security definer set search_path=public,pg_temp as $$
 select e.* from public.episodes e join public.studio_workspaces w on w.id=e.workspace_id
 where e.status in ('idea','research','script','assets','rendered') and
 (case when w.id='00000000-0000-4000-8000-000000000001' then
   exists(select 1 from public.system_config where key='pipeline' and value->>'enabled'='true')
 else w.settings#>>'{pipeline,enabled}'='true' end)
 order by e.updated_at,e.id limit 1;
$$;
revoke all on function public.studio_next_episode() from public,anon,authenticated;
grant execute on function public.studio_next_episode() to service_role;
create function public.studio_workspace_immutable() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin if new.workspace_id<>old.workspace_id then raise check_violation using message='Workspace immutable';end if;return new;end $$;
create trigger studio_workspace_immutable before update on public.episodes for each row execute function public.studio_workspace_immutable();
revoke all on function public.studio_workspace_immutable() from public,anon,authenticated;

-- Legacy credentials may only publish the original workspace.
create or replace function public.reserve_buffer_tiktok_post(p_episode_id uuid,p_owner uuid) returns public.publishes
language plpgsql security definer set search_path=public,pg_temp as $$
declare ep public.episodes; req public.review_requests; pub public.publishes; cfg jsonb;
begin
  if p_owner is null then raise check_violation using message='Owner required'; end if;
  select * into ep from public.episodes where id=p_episode_id and workspace_id='00000000-0000-4000-8000-000000000001' for update;
  if not found then raise check_violation using message='Episode missing'; end if;
  select value into cfg from public.system_config where key='buffer_tiktok';
  if cfg->'enabled' is distinct from 'true'::jsonb or (cfg->>'automatic_after')::timestamptz is null
    or ep.approval_date < (cfg->>'automatic_after')::timestamptz then
    raise check_violation using message='Buffer TikTok disabled'; end if;
  if ep.status<>'review' or ep.approval_fingerprint is null
    or ep.approval_fingerprint is distinct from public.review_fingerprint(ep)
    or ep.script_json#>>'{platform_ctas,tiktok,commercial}' is distinct from 'false'
    or ep.script_json#>>'{disclosures,commercial_content}' is distinct from 'false'
    or ep.metadata#>>'{render_outputs,platforms,tiktok,commercial}' is distinct from 'false'
    or nullif(ep.metadata#>>'{render_outputs,platforms,tiktok,portrait}','') is null
    or public.affiliate_link_for_platform(ep.product_compliance,'tiktok') is not null then
    raise check_violation using message='Approved organic TikTok render required'; end if;
  select * into req from public.review_requests where episode_id=ep.id and decision='approved'
    and fingerprint=ep.approval_fingerprint and user_id=ep.approval_user and decided_at=ep.approval_date
    and buffer_tiktok_consent for update;
  if not found then raise check_violation using message='Explicit Buffer TikTok consent required'; end if;
  select * into pub from public.publishes where episode_id=ep.id and platform='tiktok' and variant='portrait' for update;
  if found then return pub; end if;
  insert into public.publishes(episode_id,platform,variant,privacy,status,review_request_id,review_fingerprint,
    review_snapshot,upload_config,commercial_disclosure,lease_owner,lease_until)
    values(ep.id,'tiktok','portrait','public','processing',req.id,req.fingerprint,
      req.snapshot,cfg,false,p_owner,clock_timestamp()+interval '5 minutes') returning * into pub;
  insert into public.job_events(episode_id,event_type,metadata) values(ep.id,'publish_started',
    jsonb_build_object('publish_id',pub.id,'platform','tiktok','provider','buffer','stage','reserved'));
  return pub;
end $$;

-- Legacy credentials may only publish the original workspace.
create or replace function public.reserve_buffer_youtube_short(p_episode_id uuid,p_owner uuid) returns public.publishes
language plpgsql security definer set search_path=public,pg_temp as $$
declare ep public.episodes; req public.review_requests; pub public.publishes; cfg jsonb; direct_cfg jsonb;
begin
  if p_owner is null then raise check_violation using message='Owner required'; end if;
  select * into ep from public.episodes where id=p_episode_id and workspace_id='00000000-0000-4000-8000-000000000001' for update;
  if not found then raise check_violation using message='Episode missing'; end if;
  select value into cfg from public.system_config where key='buffer_youtube';
  select value into direct_cfg from public.system_config where key='youtube';
  if cfg->>'provider' is distinct from 'buffer' or cfg->'enabled' is distinct from 'true'::jsonb
    or (cfg->>'automatic_after')::timestamptz is null
    or ep.approval_date < (cfg->>'automatic_after')::timestamptz
    or (direct_cfg->'public_shorts_enabled'='true'::jsonb and direct_cfg->'api_audit_approved'='true'::jsonb) then
    raise check_violation using message='Buffer YouTube disabled or direct uploader active'; end if;
  if ep.status<>'review' or ep.approval_fingerprint is null
    or ep.approval_fingerprint is distinct from public.review_fingerprint(ep)
    or ep.script_json#>>'{platform_ctas,youtube,commercial}' is distinct from 'false'
    or ep.script_json#>>'{disclosures,commercial_content}' is distinct from 'false'
    or ep.metadata#>>'{render_outputs,platforms,youtube,portrait}' is distinct from ep.render_url
    or nullif(ep.metadata#>>'{render_outputs,portrait}','') is null
    or public.affiliate_link_for_platform(ep.product_compliance,'youtube') is not null then
    raise check_violation using message='Approved organic YouTube Short required'; end if;
  select * into req from public.review_requests where episode_id=ep.id and decision='approved'
    and fingerprint=ep.approval_fingerprint and user_id=ep.approval_user and decided_at=ep.approval_date
    and buffer_youtube_consent for update;
  if not found then raise check_violation using message='Explicit Buffer YouTube consent required'; end if;
  select * into pub from public.publishes where episode_id=ep.id and platform='youtube' and variant='portrait' for update;
  if found then return pub; end if;
  insert into public.publishes(episode_id,platform,variant,privacy,status,review_request_id,review_fingerprint,
    review_snapshot,upload_config,commercial_disclosure,lease_owner,lease_until)
    values(ep.id,'youtube','portrait','public','processing',req.id,req.fingerprint,
      req.snapshot,cfg,false,p_owner,clock_timestamp()+interval '5 minutes') returning * into pub;
  insert into public.job_events(episode_id,event_type,metadata) values(ep.id,'publish_started',
    jsonb_build_object('publish_id',pub.id,'platform','youtube','provider','buffer','stage','reserved'));
  return pub;
end $$;

-- Legacy credentials may only publish the original workspace.
create or replace function public.claim_youtube_short_upload(p_episode_id uuid,p_owner uuid) returns public.publishes
language plpgsql security definer set search_path=public,pg_temp as $$
declare ep public.episodes; pub public.publishes; req public.review_requests; cfg jsonb;
begin
  if p_owner is null then raise check_violation using message='Owner required'; end if;
  select * into ep from public.episodes where id=p_episode_id and workspace_id='00000000-0000-4000-8000-000000000001' for update;
  if not found then raise check_violation using message='Episode missing'; end if;
  if ep.status<>'review' or ep.approval_fingerprint is null or ep.approval_date is null
    or ep.script_json#>>'{platform_ctas,youtube,commercial}' is distinct from 'false'
    or ep.script_json#>>'{disclosures,commercial_content}' is distinct from 'false'
    or public.affiliate_link_for_platform(ep.product_compliance,'youtube') is not null
    or ep.metadata#>>'{render_outputs,platforms,youtube,portrait}' is distinct from ep.render_url
    or not exists(select 1 from public.review_requests r where r.episode_id=ep.id and r.decision='approved'
      and r.fingerprint=ep.approval_fingerprint and r.youtube_public_consent) then
    raise check_violation using message='Approved organic YouTube Short required'; end if;
  if exists(select 1 from public.publishes where episode_id=ep.id and platform='youtube' and variant is null) then
    raise check_violation using message='Reconcile legacy YouTube upload first'; end if;
  select * into pub from public.publishes where episode_id=ep.id and platform='youtube' and variant='portrait' for update;
  if found then
    if pub.status='published' then return pub; end if;
    if pub.lease_until>clock_timestamp() and pub.lease_owner is distinct from p_owner then
      raise lock_not_available using message='Short upload already running'; end if;
    if pub.session_url is null then
      select value into cfg from public.system_config where key='youtube';
      select * into req from public.review_requests where episode_id=ep.id and decision='approved'
        and fingerprint=ep.approval_fingerprint and user_id=ep.approval_user and decided_at=ep.approval_date;
      if not found then raise check_violation using message='Approved review required'; end if;
      update public.publishes set review_request_id=req.id,review_fingerprint=req.fingerprint,
        review_snapshot=req.snapshot,upload_config=cfg where id=pub.id;
    end if;
    update public.publishes set lease_owner=p_owner,lease_until=clock_timestamp()+interval '20 minutes'
      where id=pub.id returning * into pub;
  else
    select value into cfg from public.system_config where key='youtube';
    select * into req from public.review_requests where episode_id=ep.id and decision='approved'
      and fingerprint=ep.approval_fingerprint and user_id=ep.approval_user and decided_at=ep.approval_date;
    if not found then raise check_violation using message='Approved review required'; end if;
    insert into public.publishes(episode_id,platform,variant,privacy,status,review_request_id,review_fingerprint,
      review_snapshot,upload_config,commercial_disclosure,lease_owner,lease_until)
      values(ep.id,'youtube','portrait','public','processing',req.id,req.fingerprint,req.snapshot,cfg,
        false,p_owner,clock_timestamp()+interval '20 minutes') returning * into pub;
    insert into public.job_events(episode_id,event_type,metadata) values(ep.id,'publish_started',
      jsonb_build_object('publish_id',pub.id,'privacy','public','platform','youtube','variant','portrait'));
  end if;
  perform public.check_youtube_short_upload(pub.id,p_owner);
  return pub;
end $$;

-- Scope legacy queue operations and quotas to their original workspace.
create or replace function public.consume_next_idea() returns table(episode_id uuid,idea_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare cap integer;
begin
  perform pg_advisory_xact_lock(hashtext('content-ai-daily-cap'));
  select (value->>'max_episodes_per_day')::integer into strict cap from public.system_config where key='pipeline';
  if cap < 0 then raise check_violation using message='Invalid daily cap'; end if;
  if (select count(*) from public.episodes where workspace_id='00000000-0000-4000-8000-000000000001' and created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') >= cap then return; end if;
  return query select * from public.consume_next_idea_unchecked();
end $$;

-- Scope legacy queue operations and quotas to their original workspace.
create or replace function public.telegram_queue_command(p_update_id bigint,p_chat_id text,p_user_id text,p_command text,
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
    select count(*) into pending_count from public.idea_queue where workspace_id='00000000-0000-4000-8000-000000000001' and status='pending';
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
    select * into idea from public.idea_queue where workspace_id='00000000-0000-4000-8000-000000000001' and id=p_idea_id for update;
    if not found then output:=jsonb_build_object('code','not_found');
    elsif idea.status='consumed' then output:=jsonb_build_object('code','already_started','episode_id',idea.episode_id);
    elsif idea.status='rejected' then output:=jsonb_build_object('code','already_cancelled');
    else
      update public.idea_queue set status='rejected' where id=idea.id;
      output:=jsonb_build_object('code','cancelled','idea_id',idea.id);
    end if;
  else
    output:=jsonb_build_object('code','queue',
      'total_pending',(select count(*) from public.idea_queue where workspace_id='00000000-0000-4000-8000-000000000001' and status='pending'),
      'pipeline_enabled',exists(select 1 from public.system_config where key='pipeline' and value->'enabled'='true'::jsonb),
      'items',coalesce((select jsonb_agg(to_jsonb(q)) from (
        select id,left(briefing,100) as briefing from public.idea_queue where workspace_id='00000000-0000-4000-8000-000000000001' and status='pending' order by priority,created_at,id limit 10
      ) q),'[]'::jsonb),
      'recent',coalesce((select jsonb_agg(to_jsonb(q)) from (
        select i.episode_id,e.status from public.idea_queue i join public.episodes e on e.id=i.episode_id
        where i.workspace_id='00000000-0000-4000-8000-000000000001' and i.status='consumed' order by i.consumed_at desc,i.id limit 3
      ) q),'[]'::jsonb));
  end if;
  update public.telegram_commands set result=output,reply_status='sending' where update_id=p_update_id;
  return output;
end $$;

-- Scope legacy queue operations and quotas to their original workspace.
create or replace function public.web_panel_mutation(p_request_id uuid,p_actor uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare prior public.web_panel_commands; inserted uuid; idea public.idea_queue; cfg public.system_config;
  output jsonb; limits jsonb; links jsonb; max_pending int; daily_cap int; niche_name text; priority_value int;
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
      links:=coalesce(p_payload->'affiliate_links','{}'::jsonb);
      if jsonb_typeof(p_payload->'briefing') is distinct from 'string' or char_length(btrim(p_payload->>'briefing')) not between 20 and 2000
        or priority_value is null or priority_value not between 1 and 1000 then raise check_violation using message='Invalid briefing/priority'; end if;
      if not public.valid_affiliate_links(links) then raise check_violation using message='Invalid affiliate links'; end if;
      if p_payload->>'product_url' is not null and (char_length(p_payload->>'product_url')>2048
        or p_payload->>'product_url' !~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$') then
        raise check_violation using message='Invalid product URL'; end if;
      if links<>'{}'::jsonb and p_payload->>'product_url' is not null then
        raise check_violation using message='Use platform links instead of legacy product URL'; end if;
    end if;
    if p_action='add' then
      select value into limits from public.system_config where key='telegram_queue';
      max_pending:=(limits->>'max_pending')::int; daily_cap:=(limits->>'max_additions_per_day')::int;
      select value->>'name' into niche_name from public.system_config where key='niche';
      if limits->'enabled' is distinct from 'true'::jsonb then output:='{"code":"disabled"}';
      elsif max_pending is null or max_pending not between 1 and 100 or daily_cap is null or daily_cap not between 1 and 100
        or nullif(btrim(niche_name),'') is null then raise check_violation using message='Invalid queue configuration';
      elsif (select count(*) from public.idea_queue where workspace_id='00000000-0000-4000-8000-000000000001' and status='pending')>=max_pending then output:='{"code":"queue_full"}';
      elsif (select count(*) from public.idea_queue where workspace_id='00000000-0000-4000-8000-000000000001' and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=daily_cap then output:='{"code":"daily_limit"}';
      else
        insert into public.idea_queue(briefing,niche,product_url,affiliate_links,priority)
          values(btrim(p_payload->>'briefing'),niche_name,p_payload->>'product_url',links,priority_value) returning * into idea;
        output:=jsonb_build_object('code','created','idea_id',idea.id);
      end if;
    else
      select * into idea from public.idea_queue where workspace_id='00000000-0000-4000-8000-000000000001' and id=(p_payload->>'id')::uuid for update;
      if not found then output:='{"code":"not_found"}';
      elsif idea.status<>'pending' then output:='{"code":"already_started"}';
      elsif idea.revision is distinct from (p_payload->>'revision')::int then output:='{"code":"conflict"}';
      elsif p_action='cancel' then
        update public.idea_queue set status='rejected' where id=idea.id;
        output:=jsonb_build_object('code','cancelled','idea_id',idea.id);
      else
        update public.idea_queue set briefing=btrim(p_payload->>'briefing'),product_url=p_payload->>'product_url',
          affiliate_links=links,priority=priority_value,validated_at=now() where id=idea.id;
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

-- Scope legacy queue operations and quotas to their original workspace.
create or replace function public.web_panel_candidate_action(
  p_request_id uuid,p_actor uuid,p_action text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare prior public.web_panel_commands; inserted uuid; idea public.idea_queue;
  output jsonb; rec jsonb; idx integer; cfg jsonb; cap integer;
  v_episode uuid; v_idea uuid; v_brief text;
begin
  if p_request_id is null or p_actor is null or p_action not in ('choose_product','generate_video')
    or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>2000 then
    raise check_violation using message='Invalid candidate command'; end if;
  insert into public.web_panel_commands(request_id,actor,action,payload)
    values(p_request_id,p_actor,p_action,p_payload)
    on conflict(request_id) do nothing returning request_id into inserted;
  if inserted is null then
    select * into prior from public.web_panel_commands where request_id=p_request_id;
    if prior.actor<>p_actor or prior.action<>p_action or prior.payload<>p_payload then
      raise check_violation using message='Replay payload mismatch'; end if;
    return prior.result;
  end if;
  perform pg_advisory_xact_lock(hashtext('content-ai-daily-cap'));
  perform pg_advisory_xact_lock(hashtext('content-ai-telegram-queue'));
  select * into idea from public.idea_queue where workspace_id='00000000-0000-4000-8000-000000000001' and id=(p_payload->>'id')::uuid for update;
  if not found then output:='{"code":"not_found"}';
  elsif idea.status<>'pending' then output:=jsonb_build_object('code','already_started','episode_id',idea.episode_id);
  elsif idea.source<>'trend_discovery' then output:='{"code":"not_candidate"}';
  elsif idea.revision is distinct from (p_payload->>'revision')::int then output:='{"code":"conflict"}';
  elsif p_action='choose_product' then
    idx:=(p_payload->>'index')::int;
    if idx is null or idx<0 or idx>=jsonb_array_length(idea.recommendations) then
      raise check_violation using message='Invalid recommendation'; end if;
    rec:=idea.recommendations->idx;
    if jsonb_typeof(rec) is distinct from 'object'
      or char_length(coalesce(rec->>'product_name','')) not between 8 and 160
      or char_length(coalesce(rec->>'hook','')) not between 20 and 240
      or char_length(coalesce(rec->>'problem','')) not between 15 and 240
      or coalesce(rec->>'source_url','') !~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$' then
      raise check_violation using message='Invalid recommendation content'; end if;
    v_brief:=format('Produto específico: %s. Gancho visual: %s. Problema: %s. Fonte para checagem: %s. Limitação: %s. Criar um único vídeo sobre este produto; verificar cada alegação na pesquisa, usar apenas imagens licenciadas e CTA orgânico sem link afiliado não confirmado.',
      rec->>'product_name',rec->>'hook',rec->>'problem',rec->>'source_url',coalesce(rec->>'limitation','não verificada'));
    update public.idea_queue set briefing=left(v_brief,2000),selected_product=rec->>'product_name',
      selected_hook=rec->>'hook',selected_evidence_url=rec->>'source_url',validated_at=null
      where id=idea.id;
    output:=jsonb_build_object('code','product_chosen','idea_id',idea.id);
  else
    select value into cfg from public.system_config where key='pipeline';
    if cfg->'enabled' is distinct from 'true'::jsonb then output:='{"code":"pipeline_paused"}';
    elsif idea.selected_product is null or idea.selected_hook is null or idea.selected_evidence_url is null
      then output:='{"code":"product_required"}';
    elsif exists(select 1 from public.episodes where workspace_id='00000000-0000-4000-8000-000000000001' and status in ('idea','research','script','assets','rendered'))
      then output:='{"code":"production_busy"}';
    else
      cap:=(cfg->>'max_episodes_per_day')::int;
      if cap is null or cap not between 1 and 10 then raise check_violation using message='Invalid daily cap'; end if;
      if (select count(*) from public.episodes
        where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=cap
        then output:='{"code":"daily_cap_reached"}';
      else
        update public.idea_queue set validated_at=now(),generation_requested_at=now() where id=idea.id;
        select episode_id,idea_id into v_episode,v_idea from public.consume_idea_unchecked(idea.id);
        if v_episode is null then raise check_violation using message='Candidate could not be consumed'; end if;
        insert into public.job_events(episode_id,event_type,metadata)
          values(v_episode,'state_transition',jsonb_build_object('to','idea','idea_id',v_idea,'source','studio'));
        output:=jsonb_build_object('code','started','idea_id',v_idea,'episode_id',v_episode);
      end if;
    end if;
  end if;
  update public.web_panel_commands set result=output where request_id=p_request_id;
  return output;
end $$;
