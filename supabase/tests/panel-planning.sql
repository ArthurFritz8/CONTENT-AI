\set ON_ERROR_STOP on
begin;
do $$
declare actor uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();workspace uuid;sample uuid:=gen_random_uuid();result jsonb;
begin
 workspace:=public.studio_provision(actor,'Private sample approval audit',false);
 perform public.register_story_style_sample(workspace,jsonb_build_object('id',sample,'style_id','cinematic_3d','source','puter','title','Approved short preview',
  'model','togetherai:wan-ai/wan2.7-i2v','sha256',repeat('a',64),'bytes',100,'seconds',5,'width',720,'height',1280,'output_fps',30,'native_fps',30,
  'has_audio',true,'motion','generated','review_scope','reviewed_sample','limitations',jsonb_build_array('Approval applies to this preview only.')));
 begin perform public.studio_story_sample_approve(workspace,actor,sample,repeat('a',64));raise exception 'Unready sample approved';exception when insufficient_privilege then null;end;
 perform public.ready_story_style_sample(workspace,sample,repeat('a',64));
 begin perform public.studio_story_sample_approve(workspace,outsider,sample,repeat('a',64));raise exception 'Foreign actor approved';exception when insufficient_privilege then null;end;
 begin perform public.studio_story_sample_approve(workspace,actor,sample,repeat('b',64));raise exception 'Other bytes approved';exception when insufficient_privilege then null;end;
 perform public.studio_story_sample_approve(workspace,actor,sample,repeat('a',64));
 perform public.studio_story_sample_approve(workspace,actor,sample,repeat('a',64));
 if (select count(*) from public.studio_story_sample_approvals where sample_id=sample)<>1 then raise exception 'Approval replay duplicated';end if;
 result:=public.studio_story_style_gallery(workspace,actor);
 if result#>>'{0,approval_scope}'<>'sample_only' or result#>>'{0,approved_at}' is null then raise exception 'Approval absent from gallery';end if;
 if result::text like '%sha256%' or result::text like '%approved_by%' then raise exception 'Private approval data exposed';end if;
 begin update public.studio_story_sample_approvals set approved_at=approved_at+interval '1 second' where sample_id=sample;raise exception 'Approval was mutable';exception when check_violation then null;end;
 if has_table_privilege('authenticated','public.studio_story_sample_approvals','select') or has_function_privilege('authenticated','public.studio_story_sample_approve(uuid,uuid,uuid,text)','execute') then raise exception 'Approval ledger exposed';end if;
end $$;
rollback;