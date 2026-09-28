-- ADR-040: public YouTube Shorts through Buffer's connected channel, never the unaudited direct uploader.
alter table public.review_requests add column buffer_youtube_consent boolean not null default false;

insert into public.system_config(key,value)
values ('buffer_youtube','{"enabled":false,"automatic_after":null,"provider":"buffer"}'::jsonb)
on conflict(key) do nothing;

create function public.reserve_buffer_youtube_short(p_episode_id uuid,p_owner uuid) returns public.publishes
language plpgsql security definer set search_path=public,pg_temp as $$
declare ep public.episodes; req public.review_requests; pub public.publishes; cfg jsonb; direct_cfg jsonb;
begin
  if p_owner is null then raise check_violation using message='Owner required'; end if;
  select * into ep from public.episodes where id=p_episode_id for update;
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

create function public.record_buffer_youtube_short(p_id uuid,p_owner uuid,p_external_id text,p_channel_id text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare pub public.publishes;
begin
  select * into pub from public.publishes where id=p_id for update;
  if not found or pub.platform<>'youtube' or pub.variant<>'portrait' or pub.status<>'processing'
    or pub.external_id is not null or pub.lease_owner is distinct from p_owner
    or pub.lease_until<=clock_timestamp() or p_external_id is null or length(p_external_id) not between 1 and 128
    or p_channel_id is null or length(p_channel_id) not between 1 and 128 then
    raise check_violation using message='Invalid Buffer YouTube checkpoint'; end if;
  update public.publishes set external_id=p_external_id,channel_id=p_channel_id,
    provider_checked_at=clock_timestamp(),lease_owner=null,lease_until=null where id=p_id;
  insert into public.job_events(episode_id,event_type,metadata) values(pub.episode_id,'publish_started',
    jsonb_build_object('publish_id',p_id,'platform','youtube','provider','buffer',
      'stage','scheduled','external_id',p_external_id));
end $$;

create function public.record_buffer_youtube_status(p_id uuid,p_external_id text,p_status text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare pub public.publishes;
begin
  select * into pub from public.publishes where id=p_id for update;
  if not found or pub.platform<>'youtube' or pub.variant<>'portrait' or pub.external_id is distinct from p_external_id
    or pub.status not in ('processing','published','failed') or p_status not in ('scheduled','sending','sent','error') then
    raise check_violation using message='Invalid Buffer YouTube status'; end if;
  if pub.status in ('published','failed') then return; end if;
  update public.publishes set provider_checked_at=clock_timestamp(),
    status=case p_status when 'sent' then 'published' when 'error' then 'failed' else 'processing' end,
    published_at=case when p_status='sent' then clock_timestamp() else null end where id=p_id;
  if p_status in ('sent','error') then
    insert into public.job_events(episode_id,event_type,metadata) values(pub.episode_id,
      case when p_status='sent' then 'publish_completed' else 'failed' end,
      jsonb_build_object('publish_id',p_id,'platform','youtube','provider','buffer',
        'external_id',p_external_id,'provider_status',p_status));
  end if;
end $$;

revoke all on function public.reserve_buffer_youtube_short(uuid,uuid),
  public.record_buffer_youtube_short(uuid,uuid,text,text),public.record_buffer_youtube_status(uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.reserve_buffer_youtube_short(uuid,uuid),
  public.record_buffer_youtube_short(uuid,uuid,text,text),public.record_buffer_youtube_status(uuid,text,text)
  to service_role;

-- A single Telegram decision chooses the destination(s) atomically. Old rv:a cards retain their original scope.
create or replace function public.decide_review(p_request_id uuid,p_update_id bigint,p_action text,p_chat_id text,p_user_id text,p_message_id bigint)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare req public.review_requests; ep public.episodes; prior public.telegram_updates; result text;
  decision_time timestamptz:=clock_timestamp(); approval boolean;
begin
  approval:=p_action in ('approve','approve_tiktok','approve_youtube','approve_both');
  if p_action is null or p_action not in ('approve','approve_tiktok','approve_youtube','approve_both','rerender','reject')
    or p_update_id is null or p_update_id<0 then
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
  elsif (p_action='approve_tiktok' and not req.buffer_tiktok_consent)
    or (p_action='approve_youtube' and not (req.buffer_youtube_consent or req.youtube_public_consent))
    or (p_action='approve_both' and not (req.buffer_tiktok_consent
      and (req.buffer_youtube_consent or req.youtube_public_consent))) then
    result:='unauthorized';
  else
    result:=case when approval then 'approved' when p_action='rerender' then 'rerender_requested' else 'rejected' end;
    update public.review_requests set decision=case when approval then 'approved' else 'rejected' end,
      decided_at=decision_time,
      buffer_tiktok_consent=case when p_action='approve_youtube' then false else buffer_tiktok_consent end,
      buffer_youtube_consent=case when p_action='approve_tiktok' then false else buffer_youtube_consent end,
      youtube_public_consent=case when p_action='approve_tiktok' then false else youtube_public_consent end
      where id=req.id;
    if approval then
      update public.episodes set approval_user=p_user_id,approval_date=decision_time,
        approval_fingerprint=req.fingerprint where id=ep.id;
    elsif p_action='rerender' then
      update public.episodes set status='assets' where id=ep.id;
    else
      update public.episodes set status='failed',failure_reason='human_review_rejected' where id=ep.id;
    end if;
    insert into public.job_events(episode_id,event_type,metadata)
      values(ep.id,case when approval then 'approval_received' else 'approval_rejected' end,
      jsonb_build_object('request_id',req.id,'fingerprint',req.fingerprint,'action',p_action,
        'user_id',p_user_id,'chat_id',p_chat_id,'update_id',p_update_id));
  end if;
  insert into public.telegram_updates(update_id,request_id,action,chat_id,user_id,message_id,result)
    values(p_update_id,p_request_id,p_action,p_chat_id,p_user_id,p_message_id,result);
  return result;
end $$;
