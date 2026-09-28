-- ADR-041: a trend headline is a research lead, never an approved product.
alter table public.idea_queue
  add column recommendations jsonb not null default '[]'::jsonb,
  add column recommendation_checked_at timestamptz,
  add column selected_product text,
  add column selected_hook text,
  add column selected_evidence_url text,
  add column generation_requested_at timestamptz;

alter table public.idea_queue
  add constraint idea_queue_recommendations_array check (jsonb_typeof(recommendations) = 'array'),
  add constraint idea_queue_selected_product_length check (selected_product is null or char_length(selected_product) between 8 and 160),
  add constraint idea_queue_selected_hook_length check (selected_hook is null or char_length(selected_hook) between 20 and 240),
  add constraint idea_queue_selected_evidence_https check (selected_evidence_url is null or selected_evidence_url ~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$');

-- The old edit button set validated_at without a product decision. Revoke those
-- accidental approvals; already consumed episodes remain untouched.
update public.idea_queue set validated_at = null
where source = 'trend_discovery' and status = 'pending' and selected_product is null;

create function public.consume_idea_unchecked(p_idea_id uuid)
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
  insert into public.episodes(status,briefing,product_compliance,product_image_url)
  values('idea',jsonb_build_object(
    'text',v_idea.briefing,'niche',v_idea.niche,'category',v_idea.category,
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
    where status='pending' and (source<>'trend_discovery' or
      (validated_at is not null and generation_requested_at is not null
       and selected_product is not null
       and selected_hook is not null and selected_evidence_url is not null))
    order by priority,created_at,id limit 1 for update skip locked;
  if v_id is null then return; end if;
  return query select * from public.consume_idea_unchecked(v_id);
end $$;
revoke all on function public.consume_next_idea_unchecked() from public,anon,authenticated,service_role;

-- Authenticated only through the web panel's service-role route. The idempotent
-- command ledger and the same advisory lock as consume_next_idea preserve the
-- daily cap even when the scheduler and a button click race.
create function public.web_panel_candidate_action(
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
  select * into idea from public.idea_queue where id=(p_payload->>'id')::uuid for update;
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
    elsif exists(select 1 from public.episodes where status in ('idea','research','script','assets','rendered'))
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
revoke all on function public.web_panel_candidate_action(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.web_panel_candidate_action(uuid,uuid,text,jsonb) to service_role;
