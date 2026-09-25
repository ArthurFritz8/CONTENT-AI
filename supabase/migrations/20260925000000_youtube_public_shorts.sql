-- ADR-038: public Shorts are a separate, opt-in upload from the historical private pilot.
alter table public.publishes drop constraint if exists publishes_privacy_check;
alter table public.publishes add constraint publishes_privacy_check check(privacy in ('private','public'));
alter table public.review_requests add column youtube_public_consent boolean not null default false;

update public.system_config set value=value || jsonb_build_object(
  'public_shorts_enabled',false,'api_audit_approved',false,'automatic_after',null)
where key='youtube' and not (value ? 'public_shorts_enabled');

create function public.check_youtube_short_upload(p_id uuid,p_owner uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare pub public.publishes; ep public.episodes; cfg jsonb;
begin
  select * into pub from public.publishes where id=p_id;
  if not found or pub.platform is distinct from 'youtube' or pub.variant is distinct from 'portrait'
    or pub.privacy is distinct from 'public' or pub.lease_owner is distinct from p_owner
    or pub.lease_until is null or pub.lease_until<=clock_timestamp() or pub.status<>'processing' then
    raise check_violation using message='Short upload lease invalid'; end if;
  select * into ep from public.episodes where id=pub.episode_id;
  if ep.status<>'review' or ep.approval_fingerprint is distinct from pub.review_fingerprint
    or public.review_fingerprint(ep) is distinct from pub.review_fingerprint
    or not exists(select 1 from public.review_requests r where r.id=pub.review_request_id and r.decision='approved'
      and r.user_id=ep.approval_user and r.decided_at=ep.approval_date and r.youtube_public_consent) then
    raise check_violation using message='Current editorial approval required'; end if;
  select value into cfg from public.system_config where key='youtube';
  if cfg->'enabled' is distinct from 'true'::jsonb or cfg->'public_shorts_enabled' is distinct from 'true'::jsonb
    or cfg->'api_audit_approved' is distinct from 'true'::jsonb or (cfg->>'automatic_after')::timestamptz is null
    or ep.approval_date < (cfg->>'automatic_after')::timestamptz then
    raise check_violation using message='Public Shorts disabled or API audit not confirmed'; end if;
end $$;

create function public.claim_youtube_short_upload(p_episode_id uuid,p_owner uuid) returns public.publishes
language plpgsql security definer set search_path=public,pg_temp as $$
declare ep public.episodes; pub public.publishes; req public.review_requests; cfg jsonb;
begin
  if p_owner is null then raise check_violation using message='Owner required'; end if;
  select * into ep from public.episodes where id=p_episode_id for update;
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

create function public.authorize_youtube_short_upload(p_id uuid,p_owner uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg jsonb; pub public.publishes; cap integer; used integer; today date:=(clock_timestamp() at time zone 'UTC')::date;
begin
  select value into cfg from public.system_config where key='youtube' for update;
  cap:=(cfg->>'max_sessions_per_day')::integer;
  if cap is null or cap<1 or cap>10 then raise check_violation using message='Invalid daily upload limit'; end if;
  select * into pub from public.publishes where id=p_id for update;
  perform public.check_youtube_short_upload(p_id,p_owner);
  if pub.session_url is not null then raise check_violation using message='Resume existing session'; end if;
  select coalesce(sum(session_attempts),0) into used from public.publishes where platform='youtube' and session_day=today;
  if used>=cap then raise check_violation using message='Daily upload initiation limit reached'; end if;
  update public.publishes set session_day=today,session_attempts=case when session_day=today then session_attempts+1 else 1 end where id=p_id;
end $$;

create function public.save_youtube_short_session(p_id uuid,p_owner uuid,p_url text,p_hash text,p_bytes bigint,p_channel text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare pub public.publishes;
begin
  select * into pub from public.publishes where id=p_id for update;
  perform public.check_youtube_short_upload(p_id,p_owner);
  if p_url is null or p_url !~ '^https://www[.]googleapis[.]com/upload/youtube/v3/videos[?]'
    or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_bytes is null or p_bytes<=0
    or p_channel is null or p_channel !~ '^UC[A-Za-z0-9_-]{22}$' then
    raise check_violation using message='Invalid upload checkpoint'; end if;
  if pub.session_url is not null and row(pub.session_url,pub.media_sha256,pub.media_bytes,pub.channel_id)
    is distinct from row(p_url,p_hash,p_bytes,p_channel) then
    raise check_violation using message='Upload session is immutable'; end if;
  update public.publishes set session_url=p_url,media_sha256=p_hash,media_bytes=p_bytes,channel_id=p_channel where id=p_id;
end $$;

create function public.finish_youtube_short_upload(p_id uuid,p_owner uuid,p_video_id text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare pub public.publishes;
begin
  select * into pub from public.publishes where id=p_id for update;
  if not found or pub.platform is distinct from 'youtube' or pub.variant is distinct from 'portrait'
    or pub.privacy is distinct from 'public' or pub.status not in ('processing','published')
    or pub.lease_owner is distinct from p_owner or pub.lease_until is null or pub.lease_until<=clock_timestamp()
    or pub.session_url is null or p_video_id is null or p_video_id !~ '^[A-Za-z0-9_-]{11}$' then
    raise check_violation using message='Invalid Short confirmation'; end if;
  if pub.status='published' then
    if pub.external_id is distinct from p_video_id then raise check_violation using message='Video ID mismatch'; end if;
    return;
  end if;
  update public.publishes set status='published',external_id=p_video_id,published_at=clock_timestamp() where id=p_id;
  insert into public.job_events(episode_id,event_type,metadata) values(pub.episode_id,'publish_completed',
    jsonb_build_object('publish_id',p_id,'external_id',p_video_id,'privacy','public','platform','youtube','variant','portrait','fingerprint',pub.review_fingerprint));
end $$;

revoke all on function public.check_youtube_short_upload(uuid,uuid),public.claim_youtube_short_upload(uuid,uuid),
  public.authorize_youtube_short_upload(uuid,uuid),public.save_youtube_short_session(uuid,uuid,text,text,bigint,text),
  public.finish_youtube_short_upload(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.check_youtube_short_upload(uuid,uuid),public.claim_youtube_short_upload(uuid,uuid),
  public.authorize_youtube_short_upload(uuid,uuid),public.save_youtube_short_session(uuid,uuid,text,text,bigint,text),
  public.finish_youtube_short_upload(uuid,uuid,text) to service_role;
