-- Optional image-only source. Credentials stay in Vault, never in job payloads.
alter table public.studio_connections drop constraint studio_connections_provider_check;
alter table public.studio_connections add check(provider in ('buffer','telegram','cloudflare_images'));
create or replace function public.studio_store_secret(p_workspace uuid,p_provider text,p_value jsonb,p_metadata jsonb default '{}') returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare sid uuid;
begin
 if p_provider not in ('buffer','telegram','cloudflare_images') then raise check_violation;end if;
 perform pg_advisory_xact_lock(hashtext(p_workspace::text||p_provider));
 select secret_id into sid from public.studio_connections where workspace_id=p_workspace and provider=p_provider for update;
 if sid is null then execute 'select vault.create_secret($1)' into sid using p_value::text;
 else execute 'select vault.update_secret($1,$2)' using sid,p_value::text;end if;
 insert into public.studio_connections(workspace_id,provider,secret_id,status,metadata) values(p_workspace,p_provider,sid,'connected',p_metadata)
 on conflict(workspace_id,provider) do update set secret_id=excluded.secret_id,status='connected',metadata=excluded.metadata,updated_at=now();
end $$;
create table public.studio_reference_jobs(
 id uuid primary key,workspace_id uuid not null references public.studio_workspaces(id),actor uuid not null,
 series_id uuid not null references public.studio_series(id),character_id text not null,presentation_revision int not null,style_id text not null,
 account_sha256 text not null,input jsonb not null,phase text not null default 'planned' check(phase in ('planned','submission_started','ready','blocked','uncertain')),
 media_id uuid references public.studio_production_media(id),code text,lease_token uuid,dispatched_at timestamptz,created_at timestamptz not null default now()
);
alter table public.studio_reference_jobs enable row level security;
revoke all on public.studio_reference_jobs from public,anon,authenticated;
grant all on public.studio_reference_jobs to service_role;
create function public.studio_reference_view(p_workspace uuid,p_actor uuid,p_series uuid default null) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare connection jsonb;jobs jsonb;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 if p_series is not null and not exists(select 1 from public.studio_series where id=p_series and workspace_id=p_workspace) then raise insufficient_privilege;end if;
 select jsonb_build_object('status',status,'checked_at',metadata->'checked_at','plan',metadata->'plan','model',metadata->'model') into connection from public.studio_connections where workspace_id=p_workspace and provider='cloudflare_images';
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'character_id',character_id,'phase',phase,'code',code,'media_id',media_id,'created_at',created_at) order by created_at desc),'[]') into jobs from (select * from public.studio_reference_jobs where workspace_id=p_workspace and (p_series is null or series_id=p_series) order by created_at desc limit 30) q;
 return jsonb_build_object('connection',connection,'jobs',jobs,'daily_request_cap',6,'remaining_neurons',null);
end $$;
create function public.studio_reference_request(p_workspace uuid,p_actor uuid,p_series uuid,p_request uuid,p_revision int,p_style text,p_character text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare prior public.studio_reference_jobs;c public.studio_connections;view jsonb;character jsonb;sha text;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform pg_advisory_xact_lock(hashtext('studio-command-'||p_workspace));
 select * into prior from public.studio_reference_jobs where id=p_request;
 if found then
  if prior.workspace_id<>p_workspace or prior.actor<>p_actor or prior.series_id<>p_series or prior.character_id<>p_character or prior.presentation_revision<>p_revision or prior.style_id<>p_style then raise insufficient_privilege;end if;
  return jsonb_build_object('code',case when prior.phase='planned' and prior.dispatched_at<now()-interval '2 minutes' then 'dispatch' else prior.phase end,'job_id',prior.id);
 end if;
 view:=public.studio_story_pattern_view(p_workspace,p_actor,p_series,p_revision,p_style);
 if view->>'can_configure' is distinct from 'true' then return '{"code":"profile_locked"}';end if;
 select value into character from jsonb_array_elements(view#>'{bible,cast}') where value->>'id'=p_character;
 if character is null then raise check_violation;end if;
 select * into c from public.studio_connections where workspace_id=p_workspace and provider='cloudflare_images' and status='connected';
 if not found then return '{"code":"connection_required"}';end if;
 sha:=c.metadata->>'account_sha256';if sha is null then raise check_violation;end if;
 perform pg_advisory_xact_lock(hashtext('reference-account-'||sha));
 update public.studio_reference_jobs set phase='uncertain',code='reference_execution_interrupted' where account_sha256=sha and phase='submission_started' and created_at<now()-interval '10 minutes';
 select * into prior from public.studio_reference_jobs where workspace_id=p_workspace and series_id=p_series and character_id=p_character and presentation_revision=p_revision and style_id=p_style and phase in ('planned','submission_started') order by created_at limit 1;
 if found then return jsonb_build_object('code','waiting','job_id',case when prior.workspace_id=p_workspace then prior.id else null end);end if;
 if (select count(*) from public.studio_reference_jobs where account_sha256=sha and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=6 then return '{"code":"daily_limit"}';end if;
 insert into public.studio_reference_jobs(id,workspace_id,actor,series_id,character_id,presentation_revision,style_id,account_sha256,input,dispatched_at)
 values(p_request,p_workspace,p_actor,p_series,p_character,p_revision,p_style,sha,jsonb_build_object('character',character,'world',view#>'{bible,world}','style_id',p_style),now());
 return jsonb_build_object('code','dispatch','job_id',p_request);
end $$;
create function public.claim_reference_job(p_id uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.studio_reference_jobs;c public.studio_connections;v jsonb;
begin
 select * into strict j from public.studio_reference_jobs where id=p_id for update;
 if j.phase<>'planned' then return jsonb_build_object('code',j.phase);end if;
 perform pg_advisory_xact_lock(hashtext('reference-account-'||j.account_sha256));
 update public.studio_reference_jobs set phase='uncertain',code='reference_execution_interrupted' where account_sha256=j.account_sha256 and phase='submission_started' and created_at<now()-interval '10 minutes';
 if exists(select 1 from public.studio_reference_jobs where account_sha256=j.account_sha256 and phase='submission_started') then return '{"code":"waiting"}';end if;
 select * into c from public.studio_connections where workspace_id=j.workspace_id and provider='cloudflare_images' and status='connected';
 if not found or c.metadata->>'account_sha256' is distinct from j.account_sha256 then update public.studio_reference_jobs set phase='blocked',code='connection_required' where id=j.id;return '{"code":"connection_required"}';end if;
 v:=public.studio_story_pattern_view(j.workspace_id,j.actor,j.series_id,j.presentation_revision,j.style_id);
 if v->>'can_configure' is distinct from 'true' or not exists(select 1 from jsonb_array_elements(v#>'{bible,cast}') x where x=j.input->'character') then update public.studio_reference_jobs set phase='blocked',code='profile_locked' where id=j.id;return '{"code":"profile_locked"}';end if;
 update public.studio_reference_jobs set phase='submission_started',lease_token=p_token where id=j.id;
 return jsonb_build_object('code','claimed','workspace',j.workspace_id,'actor',j.actor,'series',j.series_id,'character',j.character_id,'input',j.input,'credential',public.studio_read_secret(j.workspace_id,'cloudflare_images'));
end $$;
create function public.finish_reference_job(p_id uuid,p_token uuid,p_code text,p_media uuid default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.studio_reference_jobs;
begin
 select * into strict j from public.studio_reference_jobs where id=p_id and lease_token=p_token and phase='submission_started' for update;
 if coalesce(p_code,'')!~'^[a-z_]{1,80}$' then raise check_violation;end if;
 if p_media is not null and not exists(select 1 from public.studio_production_media where id=p_media and workspace_id=j.workspace_id and series_id=j.series_id and character_id=j.character_id and kind='reference' and ready) then raise check_violation;end if;
 update public.studio_reference_jobs set phase=case when p_media is not null then 'ready' else 'uncertain' end,media_id=p_media,code=p_code where id=j.id;
end $$;
create function public.reference_recovery_jobs() returns jsonb language sql security definer set search_path=public,pg_temp as $$
 with pending as (select id from public.studio_reference_jobs where phase='planned' and created_at>now()-interval '1 day' and (dispatched_at is null or dispatched_at<now()-interval '10 minutes') order by created_at limit 3 for update skip locked),
 claimed as (update public.studio_reference_jobs j set dispatched_at=now() from pending p where j.id=p.id returning j.id)
 select coalesce(jsonb_agg(id),'[]') from claimed
$$;
revoke all on function public.studio_reference_view(uuid,uuid,uuid),public.studio_reference_request(uuid,uuid,uuid,uuid,int,text,text),public.claim_reference_job(uuid,uuid),public.finish_reference_job(uuid,uuid,text,uuid),public.reference_recovery_jobs() from public,anon,authenticated;
grant execute on function public.studio_reference_view(uuid,uuid,uuid),public.studio_reference_request(uuid,uuid,uuid,uuid,int,text,text),public.claim_reference_job(uuid,uuid),public.finish_reference_job(uuid,uuid,text,uuid),public.reference_recovery_jobs() to service_role;
create function public.guard_reference_cast() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if new.bible->'cast' is distinct from old.bible->'cast' and exists(select 1 from public.studio_reference_jobs where series_id=old.id and phase in ('planned','submission_started')) then raise check_violation using message='Aguarde a criação das imagens antes de editar o elenco.';end if;
 return new;
end $$;
create trigger reference_cast_locked before update of bible on public.studio_series for each row execute function public.guard_reference_cast();
