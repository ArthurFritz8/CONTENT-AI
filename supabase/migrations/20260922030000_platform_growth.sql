-- ADR-037: growth policy, real CTA media variants, human candidate gate.
insert into public.system_config(key,value) values ('growth_strategy',
'{
  "enabled": true,
  "engagement_ctas": [
    "Você usaria esse gadget? Conte nos comentários.",
    "Salve esta ideia e conte como você usaria esse gadget."
  ],
  "youtube_conversion_ctas": [
    "Confira o produto pelo link no perfil do canal."
  ],
  "disclosure": "Este vídeo contém link de afiliado. Se você comprar pelo link, podemos receber uma comissão.",
  "organic_blocked_phrases": [
    "link no perfil",
    "link na bio",
    "link do produto",
    "compre",
    "comprar",
    "cupom",
    "afiliado",
    "comissão",
    "aproveite a oferta"
  ],
  "briefings": {
    "tiktok": "Hook visual e verbal honesto nos primeiros 2 segundos; curiosidade e demonstração com material autorizado. Liste 3 gadgets somente se houver 3 produtos pesquisados; senão, mostre 3 usos comprovados de um. Encerre com comentário ou salvar, SEM venda e sem link.",
    "youtube": "YouTube Short vertical: problema, demonstração, benefício verificável e limitação. Comparação ou review vale a pena, sem fingir experiência. CTA link no perfil e disclosure só após link afiliado validado; sem link, usar engajamento."
  },
  "calendar": {
    "timezone": "America/Sao_Paulo",
    "posts_per_week": 5,
    "days": [
      "mon",
      "tue",
      "wed",
      "thu",
      "fri"
    ],
    "manual_scheduling": true,
    "hypothesis_only": true,
    "youtube": [
      "12:30",
      "18:30"
    ],
    "tiktok": [
      "19:30",
      "21:00"
    ]
  },
  "measurement": {
    "cadence_days": 7,
    "checkpoints_days": [
      30,
      60,
      90
    ],
    "tiktok_followers_goal": 1000,
    "automated": false
  }
}'::jsonb) on conflict(key) do nothing;

alter table public.idea_queue add column validated_at timestamptz;
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
  where status='pending' and (source<>'trend_discovery' or validated_at is not null)
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


create or replace function public.enforce_episode_gate() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status in ('published','analyze') and
    (nullif(trim(new.approval_user), '') is null or new.approval_date is null or new.render_url is null) then
    raise check_violation using message = 'Publication requires human approval and rendered media';
  end if;
  if new.status = 'failed' and nullif(trim(new.failure_reason), '') is null then
    raise check_violation using message = 'Failure requires a nonempty reason';
  end if;
  if new.status in ('script','assets','rendered','review','published','analyze') and
    (new.script_json is null or new.script_json #>> '{disclosures,contains_synthetic_media}' is distinct from 'true') then
    raise check_violation using message = 'Script requires synthetic disclosure';
  end if;
  if (case when new.script_json ? 'platform_ctas'
    then public.affiliate_link_for_platform(new.product_compliance,'youtube') is not null
    else new.product_compliance->>'commercial_content' = 'true' end) and new.script_json is not null and
    (new.script_json #>> '{disclosures,commercial_content}' is distinct from 'true' or
     nullif(trim(new.script_json #>> '{disclosures,commercial_disclosure_text}'), '') is null) then
    raise check_violation using message = 'Affiliate episode requires commercial disclosure';
  end if;
  if new.script_json ? 'platform_ctas' and new.status in ('rendered','review','published','analyze')
    and nullif(new.metadata#>>'{render_outputs,platforms,tiktok,portrait}','') is null then
    raise check_violation using message='Organic TikTok render required';
  end if;
  return new;
end $$;


