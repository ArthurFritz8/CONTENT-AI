create function public.studio_video_queue_snapshot(p_workspace uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare providers jsonb;wallets jsonb;entries jsonb;queue_view jsonb;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 queue_view:=public.studio_video_queue_view(p_workspace,p_actor);
 select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'label',w.label,'quota_group',w.quota_group,
  'capabilities',jsonb_build_array('dialogue'),'quality',jsonb_build_array('approved_master'),
  'short_edge',704,'output_fps',60,'max_seconds',3.9375,
  'available',public.studio_modal_eligible(w.id,o.observation->>'execution_sha256') and not exists(
   select 1 from public.studio_video_jobs j where j.wallet_id=w.id and j.state in ('submitting','accepted','unknown') and not j.balance_reconciled),
  'adapter_ready',cfg.adapter_ready,'checked_at',coalesce(extract(epoch from w.checked_at)*1000,0),'cooldown_until',0,
  'free_remaining',w.remaining_units,'billing','credits','free_tier',w.free_tier,'reserved',0,'required',1,'cash_cost',0,
  'execution_sha256',o.observation->>'execution_sha256','rate_units',o.observation->'per_shot_units',
  'continuity_approvals',(select coalesce(jsonb_agg(jsonb_build_object('series_id',c.series_id,'profile_sha256',c.profile_sha256,
   'execution_sha256',c.execution_sha256,'capabilities',jsonb_build_array('dialogue'))),'[]') from public.studio_video_compatibility c
   where c.wallet_id=w.id and c.provider_id='modal-wan-s2v-h100-v1' and c.execution_sha256=o.observation->>'execution_sha256'
    and c.kind='dialogue' and c.revoked_at is null and exists(select 1 from public.studio_series s where s.id=c.series_id and s.workspace_id=p_workspace))) order by w.quota_group),'[]')
 into providers from public.studio_video_wallets w join public.studio_video_wallet_access a on a.wallet_id=w.id and a.workspace_id=p_workspace
 join public.studio_modal_wallet_config cfg on cfg.wallet_id=w.id join public.studio_modal_observations o on o.wallet_id=w.id;
 select coalesce(jsonb_agg(jsonb_build_object('quota_group',w.quota_group,'unit',w.unit,'remaining_units',w.remaining_units,
  'held_units',w.safety_units+(select coalesce(sum(greatest(j.reserved_units,coalesce(j.charged_units,0))),0)
   from public.studio_video_jobs j where j.wallet_id=w.id and not j.balance_reconciled),
  'checked_at',coalesce(extract(epoch from w.checked_at)*1000,0),'valid_until',coalesce(extract(epoch from w.valid_until)*1000,0))),'[]')
 into wallets from public.studio_video_wallets w join public.studio_video_wallet_access a on a.wallet_id=w.id and a.workspace_id=p_workspace
 where w.remaining_units is not null;
 select coalesce(jsonb_agg(item order by item.priority,item.created_at,item.id),'[]') into entries from (
  select e.id,s.id as series_id,s.bible->>'title' as title,(e.briefing#>>'{story_context,chapter_number}')::int as chapter_number,
   coalesce(q.priority,100) as priority,extract(epoch from coalesce(q.created_at,e.created_at))*1000 as created_at,
   q.id as queue_id,coalesce(q.revision,0) as revision,coalesce(q.state,'prepared') as state,
   coalesce(q.profile_sha256,public.story_episode_profile_hash(e.id)) as profile_sha256,
   case when q.state='pending' and (e.status<>'script' or e.script_hash is distinct from q.script_sha256 or
    public.story_episode_profile_hash(e.id) is distinct from q.profile_sha256) then 'script_changed'
    when q.state='pending' and exists(select 1 from public.studio_video_jobs j where j.episode_id=e.id) then 'existing_video_work'
    when exists(select 1 from public.studio_video_jobs j join public.episodes other on other.id=j.episode_id
     where other.workspace_id=p_workspace and other.id<>e.id and other.briefing#>>'{story_context,series_id}'=s.id::text
      and j.state in ('queued','submitting','accepted','unknown')) then 'waiting_previous_chapter'
    else null end as blocked_code,
   (e.briefing#>>'{story_context,chapter_number}'='1' or exists(select 1 from public.studio_story_chapters c
    join public.idea_queue i on i.id=c.idea_id join public.episodes previous on previous.id=i.episode_id and previous.workspace_id=p_workspace
    where c.series_id=s.id and c.workspace_id=p_workspace and c.chapter_number=(e.briefing#>>'{story_context,chapter_number}')::int-1
     and previous.status in ('review','published','analyze') and previous.approval_fingerprint=public.review_fingerprint(previous)
     and exists(select 1 from public.review_requests r where r.episode_id=previous.id and r.decision='approved' and r.fingerprint=previous.approval_fingerprint))) as previous_approved,
   (select coalesce(jsonb_agg(jsonb_build_object('shot',jsonb_build_object('version','1.0.0','id',scene->>'id','kind','dialogue',
     'reference_path',scene#>>'{animation,reference_path}','reference_sha256',scene#>>'{animation,reference_sha256}',
     'audio_path',scene#>>'{animation,audio_path}','audio_sha256',scene#>>'{animation,audio_sha256}',
     'seconds',3.9375,'prompt',scene#>>'{animation,prompt}','seed',scene#>'{animation,seed}','quality','approved_master',
     'min_short_edge',704,'min_output_fps',60,'continuity',jsonb_build_object('series_id',s.id,'profile_sha256',public.story_episode_profile_hash(e.id))),
     'quotes',(select coalesce(jsonb_agg(jsonb_build_object('provider_id',provider->>'id','execution_sha256',provider->>'execution_sha256',
      'units',provider->'rate_units','cash_cost',0)),'[]') from jsonb_array_elements(providers) provider)) order by (scene->>'order')::int),'[]')
    from jsonb_array_elements(e.script_json->'scenes') scene) as shots
  from public.episodes e join public.studio_series s on s.workspace_id=e.workspace_id and s.id=(e.briefing#>>'{story_context,series_id}')::uuid
  left join public.studio_video_queue q on q.episode_id=e.id and q.workspace_id=p_workspace
  where e.workspace_id=p_workspace and s.archived_at is null and coalesce(q.state,'prepared')<>'cancelled'
   and (q.id is not null or (e.status='script' and e.script_hash is not null and not exists(select 1 from public.studio_video_jobs j where j.episode_id=e.id)))
   and jsonb_typeof(e.script_json#>'{fiction,animation}')='object' and e.script_json#>'{fiction,native_animation}' is null
  order by coalesce(q.priority,100),coalesce(q.created_at,e.created_at),e.id limit 101
 ) item;
 return jsonb_build_object('entries',entries,'providers',providers,'wallets',wallets,'queue',queue_view,'checked_at',extract(epoch from now())*1000);
end $$;
revoke all on function public.studio_video_queue_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studio_video_queue_snapshot(uuid,uuid) to service_role;