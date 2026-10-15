-- An assembly checked under an old editorial policy cannot enter review under a
-- different one, even when its media and script byte hashes remain unchanged.
alter function public.complete_native_chapter(uuid,uuid,text,text,text) rename to complete_native_chapter_before_policy;
revoke all on function public.complete_native_chapter_before_policy(uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
create function public.complete_native_chapter(p_episode uuid,p_token uuid,p_origin text,p_script_text text,p_qa_text text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare qa jsonb;policy jsonb;
begin
 perform public.guard_native_chapter(p_episode,p_token);
 if p_qa_text is null or octet_length(p_qa_text)>1048576 then raise check_violation;end if;
 qa:=p_qa_text::jsonb;
 select value into strict policy from public.system_config where key='fact_check' for share;
 if jsonb_typeof(qa->'quality_policy') is distinct from 'object' or qa->'quality_policy' is distinct from policy then raise check_violation using message='Editorial policy changed';end if;
 return public.complete_native_chapter_before_policy(p_episode,p_token,p_origin,p_script_text,p_qa_text);
end $$;
revoke all on function public.complete_native_chapter(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.complete_native_chapter(uuid,uuid,text,text,text) to service_role;
