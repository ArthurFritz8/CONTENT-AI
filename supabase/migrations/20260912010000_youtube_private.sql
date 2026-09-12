-- ADR-019: resumable private pilot. Existing episode states stay unchanged.
alter table public.publishes
  add column variant text check(variant in ('landscape','portrait')),
  add column privacy text check(privacy='private'),
  add column review_request_id uuid references public.review_requests(id),
  add column review_fingerprint text,
  add column review_snapshot jsonb,
  add column upload_config jsonb,
  add column session_url text,
  add column media_sha256 text,
  add column media_bytes bigint,
  add column channel_id text,
  add column session_attempts integer not null default 0,
  add column session_day date,
  add column lease_owner uuid,
  add column lease_until timestamptz;
create unique index publishes_episode_variant on public.publishes(episode_id,platform,variant) where variant is not null;

create function public.check_youtube_upload(p_id uuid,p_owner uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare pub public.publishes; ep public.episodes;
begin
  select * into pub from public.publishes where id=p_id;
  if not found or pub.platform is distinct from 'youtube' or pub.variant is distinct from 'landscape' or pub.privacy is distinct from 'private'
    or pub.lease_owner is distinct from p_owner or pub.lease_until is null or pub.lease_until<=clock_timestamp() or pub.status<>'processing' then
    raise check_violation using message='Upload lease invalid'; end if;
  select * into ep from public.episodes where id=pub.episode_id;
  if ep.status<>'review' or ep.approval_fingerprint is distinct from pub.review_fingerprint
    or public.review_fingerprint(ep) is distinct from pub.review_fingerprint
    or not exists(select 1 from public.review_requests r where r.id=pub.review_request_id and r.decision='approved'
      and r.user_id=ep.approval_user and r.decided_at=ep.approval_date) then
    raise check_violation using message='Current editorial approval required'; end if;
  if not exists(select 1 from public.system_config where key='youtube' and value->'enabled'='true'::jsonb) then
    raise check_violation using message='YouTube pilot disabled'; end if;
end $$;

create function public.claim_youtube_upload(p_episode_id uuid,p_owner uuid) returns public.publishes
language plpgsql security definer set search_path=public,pg_temp as $$
declare ep public.episodes; pub public.publishes; req public.review_requests; cfg jsonb;
begin
  if p_owner is null then raise check_violation using message='Owner required'; end if;
  select * into ep from public.episodes where id=p_episode_id for update;
  if not found then raise check_violation using message='Episode missing'; end if;
  -- Historical uploads must be reconciled, never silently duplicated.
  if exists(select 1 from public.publishes where episode_id=ep.id and platform='youtube' and variant is null) then
    raise check_violation using message='Reconcile legacy YouTube upload first'; end if;
  select * into pub from public.publishes where episode_id=ep.id and platform='youtube' and variant='landscape' for update;
  if found then
    if pub.status='published' then return pub; end if;
    if pub.lease_until>clock_timestamp() and pub.lease_owner is distinct from p_owner then
      raise lock_not_available using message='Upload already running'; end if;
    update public.publishes set lease_owner=p_owner,lease_until=clock_timestamp()+interval '20 minutes'
      where id=pub.id returning * into pub;
  else
    select value into cfg from public.system_config where key='youtube';
    select * into req from public.review_requests where episode_id=ep.id and decision='approved'
      and fingerprint=ep.approval_fingerprint and user_id=ep.approval_user and decided_at=ep.approval_date;
    if not found then raise check_violation using message='Approved review required'; end if;
    insert into public.publishes(episode_id,platform,variant,privacy,status,review_request_id,review_fingerprint,
      review_snapshot,upload_config,commercial_disclosure,lease_owner,lease_until)
      values(ep.id,'youtube','landscape','private','processing',req.id,req.fingerprint,req.snapshot,cfg,
        coalesce((ep.script_json#>>'{disclosures,commercial_content}')::boolean,false),p_owner,clock_timestamp()+interval '20 minutes') returning * into pub;
    insert into public.job_events(episode_id,event_type,metadata) values(ep.id,'publish_started',jsonb_build_object('publish_id',pub.id,'privacy','private'));
  end if;
  perform public.check_youtube_upload(pub.id,p_owner);
  return pub;
end $$;

create function public.authorize_youtube_session(p_id uuid,p_owner uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg jsonb; pub public.publishes; cap integer; used integer; today date:=(clock_timestamp() at time zone 'UTC')::date;
begin
  select value into cfg from public.system_config where key='youtube' for update;
  cap:=(cfg->>'max_sessions_per_day')::integer;
  if cap is null or cap<1 or cap>10 then raise check_violation using message='Invalid daily upload limit'; end if;
  select * into pub from public.publishes where id=p_id for update;
  perform public.check_youtube_upload(p_id,p_owner);
  if pub.session_url is not null then raise check_violation using message='Resume existing session'; end if;
  select coalesce(sum(session_attempts),0) into used from public.publishes where platform='youtube' and session_day=today;
  if used>=cap then raise check_violation using message='Daily upload initiation limit reached'; end if;
  update public.publishes set session_day=today,session_attempts=case when session_day=today then session_attempts+1 else 1 end where id=p_id;
end $$;

create function public.save_youtube_session(p_id uuid,p_owner uuid,p_url text,p_hash text,p_bytes bigint,p_channel text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare pub public.publishes;
begin
  select * into pub from public.publishes where id=p_id for update;
  perform public.check_youtube_upload(p_id,p_owner);
  if p_url is null or p_url !~ '^https://www[.]googleapis[.]com/upload/youtube/v3/videos[?]'
    or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_bytes is null or p_bytes<=0
    or p_channel is null or p_channel !~ '^UC[A-Za-z0-9_-]{22}$' then
    raise check_violation using message='Invalid upload checkpoint'; end if;
  if pub.session_url is not null and row(pub.session_url,pub.media_sha256,pub.media_bytes,pub.channel_id)
    is distinct from row(p_url,p_hash,p_bytes,p_channel) then
    raise check_violation using message='Upload session is immutable'; end if;
  update public.publishes set session_url=p_url,media_sha256=p_hash,media_bytes=p_bytes,channel_id=p_channel where id=p_id;
end $$;

create function public.finish_youtube_upload(p_id uuid,p_owner uuid,p_video_id text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare pub public.publishes;
begin
  select * into pub from public.publishes where id=p_id for update;
  if not found or pub.platform is distinct from 'youtube' or pub.privacy is distinct from 'private'
    or pub.status not in ('processing','published') or pub.lease_owner is distinct from p_owner or pub.lease_until is null or pub.lease_until<=clock_timestamp()
    or pub.session_url is null or p_video_id is null or p_video_id !~ '^[A-Za-z0-9_-]{11}$' then
    raise check_violation using message='Invalid upload confirmation'; end if;
  if pub.status='published' then
    if pub.external_id is distinct from p_video_id then raise check_violation using message='Video ID mismatch'; end if;
    return;
  end if;
  -- Preserve the external result even if an approval was revoked during the last network call.
  -- A private upload does not promote the episode to published.
  update public.publishes set status='published',external_id=p_video_id,published_at=clock_timestamp() where id=p_id;
  insert into public.job_events(episode_id,event_type,metadata) values(pub.episode_id,'publish_completed',
    jsonb_build_object('publish_id',p_id,'external_id',p_video_id,'privacy','private','fingerprint',pub.review_fingerprint));
end $$;

revoke all on function public.check_youtube_upload(uuid,uuid),public.claim_youtube_upload(uuid,uuid),
  public.authorize_youtube_session(uuid,uuid),public.save_youtube_session(uuid,uuid,text,text,bigint,text),public.finish_youtube_upload(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.check_youtube_upload(uuid,uuid),public.claim_youtube_upload(uuid,uuid),
  public.authorize_youtube_session(uuid,uuid),public.save_youtube_session(uuid,uuid,text,text,bigint,text),public.finish_youtube_upload(uuid,uuid,text) to service_role;
insert into public.system_config(key,value) values('youtube',
  '{"enabled":false,"max_sessions_per_day":3,"max_video_bytes":52428800,"made_for_kids":false,"category_ids":{"Education":"27","Science & Technology":"28"}}') on conflict(key) do nothing;
