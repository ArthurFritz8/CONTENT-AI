-- ADR-085: reviewed Puter media only; production source validation is unchanged.
create or replace function public.register_story_style_sample(p_workspace uuid,p_sample jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result public.studio_story_style_samples; sid uuid:=(p_sample->>'id')::uuid; target text;
begin
 if sid is null or jsonb_typeof(p_sample) is distinct from 'object' or not(p_sample ?& array['id','style_id','source','title','model','sha256','bytes','seconds','width','height','output_fps','native_fps','has_audio','motion','review_scope','limitations']) or coalesce(p_sample->>'source','') not in ('modal','auray','local','puter') or
  coalesce(p_sample->>'style_id','') not in ('illustrated','cinematic_3d','cartoon_2d','anime','realistic','motion_comic') or
  p_sample->>'sha256' is null or p_sample->>'sha256'!~'^[a-f0-9]{64}$' or
  coalesce((p_sample->>'bytes')::bigint,0) not between 1 and 52428800 or coalesce((p_sample->>'seconds')::numeric,0) not between 1 and 120 or
  coalesce((p_sample->>'width')::int,0) not between 480 and 4096 or coalesce((p_sample->>'height')::int,0) not between 480 and 4096 or
  coalesce((p_sample->>'output_fps')::numeric,0) not between 1 and 120 or coalesce(p_sample->>'motion','') not in ('generated','interpolated','mixed','illustrated') or
  coalesce(p_sample->>'review_scope','') not in ('reviewed_sample','technical_only') or jsonb_typeof(p_sample->'limitations') is distinct from 'array' then raise check_violation; end if;
 if (select count(*) from jsonb_object_keys(p_sample))<>16 or coalesce(char_length(p_sample->>'title'),0) not between 5 and 100 or coalesce(char_length(p_sample->>'model'),0) not between 2 and 120 or
  (p_sample->>'native_fps' is not null and (p_sample->>'native_fps')::numeric not between 1 and 120) or jsonb_typeof(p_sample->'has_audio') is distinct from 'boolean' or
  jsonb_array_length(p_sample->'limitations') not between 1 and 8 or exists(select 1 from jsonb_array_elements_text(p_sample->'limitations') x where char_length(x) not between 5 and 500) then raise check_violation; end if;
 target:=p_workspace||'/story-samples/'||sid||'/'||(p_sample->>'sha256')||'.mp4';
 insert into public.studio_story_style_samples(id,workspace_id,sample,path) values(sid,p_workspace,p_sample,target) on conflict(id) do nothing;
 select * into strict result from public.studio_story_style_samples where id=sid;
 if result.workspace_id<>p_workspace or result.sample<>p_sample then raise insufficient_privilege; end if;
 return jsonb_build_object('id',sid,'path',target,'ready',result.ready);
end $$;
