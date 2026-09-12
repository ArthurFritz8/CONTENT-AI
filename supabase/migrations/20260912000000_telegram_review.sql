-- ADR-018: private review ledger and approvals tied to current editorial inputs.
alter table public.episodes add column approval_fingerprint text;

create function public.review_snapshot(ep public.episodes) returns jsonb
language sql stable set search_path=public,pg_temp as $$
  select jsonb_build_object('episode',jsonb_build_object(
    'id',ep.id,'script_hash',ep.script_hash,'script_json',ep.script_json,
    'render_url',ep.render_url,'research_data',ep.research_data,'research_evidence',ep.research_evidence,
    'product_compliance',ep.product_compliance,'metadata',jsonb_build_object(
      'render_outputs',ep.metadata->'render_outputs','render_generation',ep.metadata->'render_generation')),
    'assets',coalesce((select jsonb_agg(to_jsonb(a) - 'created_at' order by a.id) from public.assets a where a.episode_id=ep.id),'[]'::jsonb),
    'fact_check',(select value from public.system_config where key='fact_check'));
$$;
create function public.review_fingerprint(ep public.episodes) returns text
language sql stable set search_path=public,pg_temp as $$
  select encode(sha256(convert_to(public.review_snapshot(ep)::text,'UTF8')),'hex');
$$;

create table public.review_requests (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes(id),
  fingerprint text not null,
  snapshot jsonb not null check(octet_length(snapshot::text)<=1048576),
  chat_id text not null,
  user_id text not null,
  delivery_status text not null default 'sending' check(delivery_status in ('sending','sent','uncertain','failed')),
  message_id bigint,
  decision text not null default 'pending' check(decision in ('pending','approved','rejected','superseded')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  delivery_error text
);
create index review_requests_episode on public.review_requests(episode_id,created_at desc);
alter table public.review_requests enable row level security;
create table public.telegram_updates (
  update_id bigint primary key,
  request_id uuid not null references public.review_requests(id),
  action text not null,
  chat_id text not null,
  user_id text not null,
  message_id bigint not null,
  result text not null,
  created_at timestamptz not null default now()
);
alter table public.telegram_updates enable row level security;
create table public.telegram_commands (
  update_id bigint primary key, chat_id text not null, user_id text not null,
  command text not null check(command in ('help','review')), created_at timestamptz not null default now()
);
alter table public.telegram_commands enable row level security;
grant select,insert on public.telegram_commands to service_role;
grant select,update on public.review_requests to service_role;
grant select on public.telegram_updates to service_role;

create function public.prepare_review(p_chat_id text,p_user_id text,p_episode_id uuid default null,p_force boolean default false)
returns public.review_requests language plpgsql security definer set search_path=public,pg_temp as $$
declare ep public.episodes; request public.review_requests; fp text;
begin
  if p_chat_id is null or p_user_id is null or p_chat_id !~ '^-?[0-9]+$' or p_user_id !~ '^[1-9][0-9]*$' then raise check_violation using message='Invalid Telegram identity'; end if;
  if p_force and p_episode_id is null then raise check_violation using message='Force requires episode'; end if;
  select e.* into ep from public.episodes e where e.status='review' and (p_episode_id is null or e.id=p_episode_id)
    and (p_force or not exists(select 1 from public.review_requests r where r.episode_id=e.id
      and r.fingerprint=public.review_fingerprint(e) and r.decision in ('pending','approved','rejected')))
    order by e.created_at limit 1 for update skip locked;
  if not found then return null; end if;
  if ep.render_url is null then raise check_violation using message='Rendered media required'; end if;
  fp:=public.review_fingerprint(ep);
  update public.review_requests set decision='superseded' where episode_id=ep.id and decision in ('pending','approved');
  update public.episodes set approval_user=null,approval_date=null,approval_fingerprint=null where id=ep.id;
  insert into public.review_requests(episode_id,fingerprint,snapshot,chat_id,user_id)
    values(ep.id,fp,public.review_snapshot(ep),p_chat_id,p_user_id) returning * into request;
  return request;
end $$;

create function public.decide_review(p_request_id uuid,p_update_id bigint,p_action text,p_chat_id text,p_user_id text,p_message_id bigint)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare req public.review_requests; ep public.episodes; prior public.telegram_updates; result text; decision_time timestamptz:=clock_timestamp();
begin
  if p_action is null or p_action not in ('approve','rerender','reject') or p_update_id is null or p_update_id<0 then
    raise check_violation using message='Invalid review action/update'; end if;
  select * into req from public.review_requests where id=p_request_id;
  if not found then return 'not_found'; end if;
  select * into ep from public.episodes where id=req.episode_id for update;
  select * into req from public.review_requests where id=p_request_id for update;
  if req.chat_id is distinct from p_chat_id or req.user_id is distinct from p_user_id
    or req.message_id is distinct from p_message_id or req.delivery_status<>'sent' then return 'unauthorized'; end if;
  select * into prior from public.telegram_updates where update_id=p_update_id;
  if found then
    if prior.request_id<>p_request_id or prior.action<>p_action or prior.chat_id<>p_chat_id
      or prior.user_id<>p_user_id or prior.message_id<>p_message_id then return 'unauthorized'; end if;
    return prior.result;
  end if;
  if req.decision<>'pending' then result:='already_decided';
  elsif ep.status<>'review' or req.fingerprint<>public.review_fingerprint(ep) then
    result:='stale';
    update public.review_requests set decision='superseded' where id=req.id;
  else
    result:=case p_action when 'approve' then 'approved' when 'rerender' then 'rerender_requested' else 'rejected' end;
    update public.review_requests set decision=case when p_action='approve' then 'approved' else 'rejected' end,
      decided_at=decision_time where id=req.id;
    if p_action='approve' then
      update public.episodes set approval_user=p_user_id,approval_date=decision_time,approval_fingerprint=req.fingerprint where id=ep.id;
    elsif p_action='rerender' then
      update public.episodes set status='assets' where id=ep.id;
    else
      update public.episodes set status='failed',failure_reason='human_review_rejected' where id=ep.id;
    end if;
    insert into public.job_events(episode_id,event_type,metadata)
      values(ep.id,case when p_action='approve' then 'approval_received' else 'approval_rejected' end,
      jsonb_build_object('request_id',req.id,'fingerprint',req.fingerprint,'action',p_action,'user_id',p_user_id,'chat_id',p_chat_id,'update_id',p_update_id));
  end if;
  insert into public.telegram_updates(update_id,request_id,action,chat_id,user_id,message_id,result)
    values(p_update_id,p_request_id,p_action,p_chat_id,p_user_id,p_message_id,result);
  return result;
end $$;

create function public.invalidate_review_approval() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if row(new.script_json,new.script_hash,new.render_url,new.research_data,new.research_evidence,new.product_compliance,
      new.metadata->'render_outputs',new.metadata->'render_generation') is distinct from
    row(old.script_json,old.script_hash,old.render_url,old.research_data,old.research_evidence,old.product_compliance,
      old.metadata->'render_outputs',old.metadata->'render_generation') or new.status in ('script','assets')
      or (new.status='failed' and old.status not in ('published','analyze')) then
    new.approval_user:=null; new.approval_date:=null; new.approval_fingerprint:=null;
  end if;
  return new;
end $$;
create trigger episodes_y_review_invalidate before update on public.episodes
  for each row execute function public.invalidate_review_approval();

create function public.enforce_review_fingerprint() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if new.status in ('published','analyze') and (
    new.approval_fingerprint is distinct from public.review_fingerprint(new) or
    not exists(select 1 from public.review_requests r where r.episode_id=new.id and r.decision='approved'
      and r.fingerprint=new.approval_fingerprint and r.user_id=new.approval_user and r.decided_at=new.approval_date)) then
    raise check_violation using message='Publication requires approval of current review snapshot';
  end if;
  return new;
end $$;
create trigger episodes_zz_review_gate before insert or update on public.episodes
  for each row execute function public.enforce_review_fingerprint();

revoke all on function public.review_snapshot(public.episodes),public.review_fingerprint(public.episodes),
  public.prepare_review(text,text,uuid,boolean),public.decide_review(uuid,bigint,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.review_snapshot(public.episodes),public.review_fingerprint(public.episodes),
  public.prepare_review(text,text,uuid,boolean),public.decide_review(uuid,bigint,text,text,text,bigint) to service_role;

insert into public.system_config(key,value) values('telegram','{"enabled":false}') on conflict(key) do nothing;
