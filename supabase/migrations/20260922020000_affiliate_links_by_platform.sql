-- ADR-036 — operador afiliado, com link independente por plataforma.

insert into public.system_config(key,value) values('affiliate_monetization', '{
  "legacy_product_url_platform": "youtube",
  "require_platform_link_for_commercial_publish": true,
  "platforms": {
    "youtube": {"enabled": true, "providers": ["amazon", "shopee", "hotmart"]},
    "tiktok": {"enabled": false, "provider": "tiktok_shop", "minimum_followers": 1000}
  }
}'::jsonb) on conflict(key) do nothing;

create function public.valid_affiliate_links(value jsonb) returns boolean
language sql immutable set search_path=public,pg_temp as $$
  select value is not null
    and jsonb_typeof(value)='object'
    and not exists(
      select 1 from jsonb_each(value) item
      where item.key not in ('youtube','tiktok')
        or jsonb_typeof(item.value)<>'string'
        or char_length(item.value#>>'{}')>2048
        or item.value#>>'{}' !~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$'
    );
$$;

alter table public.idea_queue
  add column affiliate_links jsonb not null default '{}'::jsonb,
  add constraint idea_queue_affiliate_links_valid
    check(public.valid_affiliate_links(affiliate_links));

alter table public.publishes
  add column affiliate_url text,
  add constraint publishes_affiliate_url_valid check(
    affiliate_url is null or (
      char_length(affiliate_url)<=2048
      and affiliate_url ~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$'
    )
  );

create function public.affiliate_link_for_platform(compliance jsonb,target_platform text)
returns text language plpgsql stable set search_path=public,pg_temp as $$
declare links jsonb; legacy_platform text;
begin
  if target_platform not in ('youtube','tiktok') then
    raise check_violation using message='Unsupported affiliate platform';
  end if;
  if compliance is null or jsonb_typeof(compliance)<>'object' then return null; end if;
  links:=coalesce(compliance->'affiliate_links','{}'::jsonb);
  if jsonb_typeof(links)<>'object' or not public.valid_affiliate_links(links) then
    raise check_violation using message='Invalid episode affiliate links';
  end if;
  if links<> '{}'::jsonb then return links->>target_platform; end if;
  select value->>'legacy_product_url_platform' into legacy_platform
    from public.system_config where key='affiliate_monetization';
  if target_platform=coalesce(legacy_platform,'youtube') then
    return compliance->>'affiliate_link';
  end if;
  return null;
end $$;

-- The wrapper consume_next_idea() created by ADR-015 keeps its permissions and
-- delegates to this service-only implementation.
create or replace function public.consume_next_idea_unchecked()
returns table (episode_id uuid, idea_id uuid) as $$
#variable_conflict use_column
declare
  v_idea public.idea_queue%rowtype;
  v_episode_id uuid;
  v_links jsonb;
  v_legacy_platform text;
  v_compliance jsonb;
begin
  select * into v_idea
  from public.idea_queue
  where status='pending'
  order by priority,created_at
  limit 1
  for update skip locked;

  if not found then return; end if;

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

  insert into public.episodes(status,briefing,product_compliance,product_image_url)
  values('idea',jsonb_build_object(
    'text',v_idea.briefing,'niche',v_idea.niche,'category',v_idea.category,'idea_id',v_idea.id
  ),v_compliance,v_idea.product_image_url)
  returning id into v_episode_id;

  update public.idea_queue set status='consumed',consumed_at=now(),episode_id=v_episode_id
    where id=v_idea.id;
  return query select v_episode_id,v_idea.id;
end;
$$ language plpgsql;

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
      elsif (select count(*) from public.idea_queue where status='pending')>=max_pending then output:='{"code":"queue_full"}';
      elsif (select count(*) from public.idea_queue where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=daily_cap then output:='{"code":"daily_limit"}';
      else
        insert into public.idea_queue(briefing,niche,product_url,affiliate_links,priority)
          values(btrim(p_payload->>'briefing'),niche_name,p_payload->>'product_url',links,priority_value) returning * into idea;
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
        update public.idea_queue set briefing=btrim(p_payload->>'briefing'),product_url=p_payload->>'product_url',
          affiliate_links=links,priority=priority_value where id=idea.id;
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

create or replace function public.check_youtube_upload(p_id uuid,p_owner uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare pub public.publishes; ep public.episodes; snapshot_link text;
begin
  select * into pub from public.publishes where id=p_id;
  snapshot_link:=public.affiliate_link_for_platform(pub.review_snapshot#>'{episode,product_compliance}','youtube');
  if not found or pub.platform is distinct from 'youtube' or pub.variant is distinct from 'landscape' or pub.privacy is distinct from 'private'
    or pub.lease_owner is distinct from p_owner or pub.lease_until is null or pub.lease_until<=clock_timestamp() or pub.status<>'processing'
    or pub.affiliate_url is distinct from snapshot_link then
    raise check_violation using message='Upload lease or platform affiliate link invalid'; end if;
  select * into ep from public.episodes where id=pub.episode_id;
  if ep.status<>'review' or ep.approval_fingerprint is distinct from pub.review_fingerprint
    or public.review_fingerprint(ep) is distinct from pub.review_fingerprint
    or not exists(select 1 from public.review_requests r where r.id=pub.review_request_id and r.decision='approved'
      and r.user_id=ep.approval_user and r.decided_at=ep.approval_date) then
    raise check_violation using message='Current editorial approval required'; end if;
  if not exists(select 1 from public.system_config where key='youtube' and value->'enabled'='true'::jsonb) then
    raise check_violation using message='YouTube pilot disabled'; end if;
end $$;

create or replace function public.claim_youtube_upload(p_episode_id uuid,p_owner uuid) returns public.publishes
language plpgsql security definer set search_path=public,pg_temp as $$
declare ep public.episodes; pub public.publishes; req public.review_requests; cfg jsonb; youtube_link text; is_commercial boolean;
begin
  if p_owner is null then raise check_violation using message='Owner required'; end if;
  select * into ep from public.episodes where id=p_episode_id for update;
  if not found then raise check_violation using message='Episode missing'; end if;
  youtube_link:=public.affiliate_link_for_platform(ep.product_compliance,'youtube');
  is_commercial:=coalesce((ep.product_compliance->>'commercial_content')::boolean,false);
  if is_commercial and youtube_link is null then
    raise check_violation using message='Commercial episode has no affiliate link for YouTube'; end if;
  if exists(select 1 from public.publishes where episode_id=ep.id and platform='youtube' and variant is null) then
    raise check_violation using message='Reconcile legacy YouTube upload first'; end if;
  select * into pub from public.publishes where episode_id=ep.id and platform='youtube' and variant='landscape' for update;
  if found then
    if pub.status='published' then return pub; end if;
    if pub.lease_until>clock_timestamp() and pub.lease_owner is distinct from p_owner then
      raise lock_not_available using message='Upload already running'; end if;
    if pub.session_url is null then
      select value into cfg from public.system_config where key='youtube';
      select * into req from public.review_requests where episode_id=ep.id and decision='approved'
        and fingerprint=ep.approval_fingerprint and user_id=ep.approval_user and decided_at=ep.approval_date;
      if not found then raise check_violation using message='Approved review required'; end if;
      update public.publishes set review_request_id=req.id,review_fingerprint=req.fingerprint,
        review_snapshot=req.snapshot,upload_config=cfg,affiliate_url=youtube_link,
        commercial_disclosure=(youtube_link is not null) where id=pub.id;
    end if;
    update public.publishes set lease_owner=p_owner,lease_until=clock_timestamp()+interval '20 minutes'
      where id=pub.id returning * into pub;
  else
    select value into cfg from public.system_config where key='youtube';
    select * into req from public.review_requests where episode_id=ep.id and decision='approved'
      and fingerprint=ep.approval_fingerprint and user_id=ep.approval_user and decided_at=ep.approval_date;
    if not found then raise check_violation using message='Approved review required'; end if;
    insert into public.publishes(episode_id,platform,variant,privacy,status,review_request_id,review_fingerprint,
      review_snapshot,upload_config,commercial_disclosure,affiliate_url,lease_owner,lease_until)
      values(ep.id,'youtube','landscape','private','processing',req.id,req.fingerprint,req.snapshot,cfg,
        youtube_link is not null,youtube_link,p_owner,clock_timestamp()+interval '20 minutes') returning * into pub;
    insert into public.job_events(episode_id,event_type,metadata) values(ep.id,'publish_started',
      jsonb_build_object('publish_id',pub.id,'privacy','private','affiliate_platform','youtube','commercial',youtube_link is not null));
  end if;
  perform public.check_youtube_upload(pub.id,p_owner);
  return pub;
end $$;

-- Existing durable snapshots keep their original link after the additive column.
update public.publishes set affiliate_url=public.affiliate_link_for_platform(
  review_snapshot#>'{episode,product_compliance}','youtube'
) where platform='youtube' and affiliate_url is null and review_snapshot is not null;

revoke all on function public.valid_affiliate_links(jsonb),public.affiliate_link_for_platform(jsonb,text)
  from public,anon,authenticated;
grant execute on function public.valid_affiliate_links(jsonb),public.affiliate_link_for_platform(jsonb,text)
  to service_role;
