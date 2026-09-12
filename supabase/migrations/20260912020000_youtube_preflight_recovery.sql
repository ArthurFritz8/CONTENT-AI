-- ADR-019: allow preflight repairs before any durable upload session exists.
create or replace function public.claim_youtube_upload(p_episode_id uuid,p_owner uuid) returns public.publishes
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
    -- No durable session means no media could have been sent by this worker.
    -- Allow configuration/editorial repairs before the first transfer; never replace a session.
    if pub.session_url is null then
      select value into cfg from public.system_config where key='youtube';
      select * into req from public.review_requests where episode_id=ep.id and decision='approved'
        and fingerprint=ep.approval_fingerprint and user_id=ep.approval_user and decided_at=ep.approval_date;
      if not found then raise check_violation using message='Approved review required'; end if;
      update public.publishes set review_request_id=req.id,review_fingerprint=req.fingerprint,
        review_snapshot=req.snapshot,upload_config=cfg,
        commercial_disclosure=coalesce((ep.script_json#>>'{disclosures,commercial_content}')::boolean,false) where id=pub.id;
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
      values(ep.id,'youtube','landscape','private','processing',req.id,req.fingerprint,req.snapshot,cfg,
        coalesce((ep.script_json#>>'{disclosures,commercial_content}')::boolean,false),p_owner,clock_timestamp()+interval '20 minutes') returning * into pub;
    insert into public.job_events(episode_id,event_type,metadata) values(ep.id,'publish_started',jsonb_build_object('publish_id',pub.id,'privacy','private'));
  end if;
  perform public.check_youtube_upload(pub.id,p_owner);
  return pub;
end $$;
