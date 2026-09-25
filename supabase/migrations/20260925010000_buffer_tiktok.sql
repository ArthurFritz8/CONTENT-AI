-- ADR-039: Buffer's approved TikTok integration schedules the organic render after explicit Telegram review.
alter table public.review_requests add column buffer_tiktok_consent boolean not null default false;
alter table public.publishes add column provider_checked_at timestamptz;

insert into public.system_config(key,value)
values ('buffer_tiktok','{"enabled":false,"automatic_after":null}'::jsonb)
on conflict(key) do nothing;

create function public.reserve_buffer_tiktok_post(p_episode_id uuid,p_owner uuid) returns public.publishes
language plpgsql security definer set search_path=public,pg_temp as $$
declare ep public.episodes; req public.review_requests; pub public.publishes; cfg jsonb;
begin
  if p_owner is null then raise check_violation using message='Owner required'; end if;
  select * into ep from public.episodes where id=p_episode_id for update;
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

create function public.record_buffer_tiktok_post(p_id uuid,p_owner uuid,p_external_id text,p_channel_id text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare pub public.publishes;
begin
  select * into pub from public.publishes where id=p_id for update;
  if not found or pub.platform<>'tiktok' or pub.variant<>'portrait' or pub.status<>'processing'
    or pub.external_id is not null or pub.lease_owner is distinct from p_owner
    or pub.lease_until<=clock_timestamp() or p_external_id is null or length(p_external_id) not between 1 and 128
    or p_channel_id is null or length(p_channel_id) not between 1 and 128 then
    raise check_violation using message='Invalid Buffer post checkpoint'; end if;
  update public.publishes set external_id=p_external_id,channel_id=p_channel_id,
    provider_checked_at=clock_timestamp(),lease_owner=null,lease_until=null where id=p_id;
  insert into public.job_events(episode_id,event_type,metadata) values(pub.episode_id,'publish_started',
    jsonb_build_object('publish_id',p_id,'platform','tiktok','provider','buffer',
      'stage','scheduled','external_id',p_external_id));
end $$;

create function public.record_buffer_tiktok_status(p_id uuid,p_external_id text,p_status text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare pub public.publishes;
begin
  select * into pub from public.publishes where id=p_id for update;
  if not found or pub.platform<>'tiktok' or pub.variant<>'portrait' or pub.external_id is distinct from p_external_id
    or pub.status not in ('processing','published','failed') or p_status not in ('scheduled','sending','sent','error') then
    raise check_violation using message='Invalid Buffer status'; end if;
  if pub.status in ('published','failed') then return; end if;
  update public.publishes set provider_checked_at=clock_timestamp(),
    status=case p_status when 'sent' then 'published' when 'error' then 'failed' else 'processing' end,
    published_at=case when p_status='sent' then clock_timestamp() else null end where id=p_id;
  if p_status in ('sent','error') then
    insert into public.job_events(episode_id,event_type,metadata) values(pub.episode_id,
      case when p_status='sent' then 'publish_completed' else 'failed' end,
      jsonb_build_object('publish_id',p_id,'platform','tiktok','provider','buffer',
        'external_id',p_external_id,'provider_status',p_status));
  end if;
end $$;

revoke all on function public.reserve_buffer_tiktok_post(uuid,uuid),
  public.record_buffer_tiktok_post(uuid,uuid,text,text),public.record_buffer_tiktok_status(uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.reserve_buffer_tiktok_post(uuid,uuid),
  public.record_buffer_tiktok_post(uuid,uuid,text,text),public.record_buffer_tiktok_status(uuid,text,text)
  to service_role;
