\set ON_ERROR_STOP on
begin;
do $$begin
 if to_regnamespace('vault') is not null or (inet_server_addr() is not null and inet_server_addr() not in ('127.0.0.1'::inet,'::1'::inet)) then
  raise exception 'Puter Vault fixture requires an empty local test namespace';
 end if;
end $$;
create schema vault;
create table vault.fixture_secrets(id uuid primary key default gen_random_uuid(),value text);
create view vault.decrypted_secrets as select id,value as decrypted_secret from vault.fixture_secrets;
create function vault.create_secret(p_value text) returns uuid language sql as $$insert into vault.fixture_secrets(value) values(p_value) returning id$$;
create function vault.update_secret(p_id uuid,p_value text) returns void language sql as $$update vault.fixture_secrets set value=p_value where id=p_id$$;

create function pg_temp.native_panel_assert(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'Native panel assertion: %',label;end if;end $$;
do $$
declare actor uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();w uuid;sid uuid;request uuid:=gen_random_uuid();wallet uuid;sample uuid:=gen_random_uuid();account uuid:=gen_random_uuid();token uuid:=gen_random_uuid();pref jsonb;bib jsonb;profile jsonb;r jsonb;refs jsonb:='[]';directions jsonb:='[]';c jsonb;mid uuid;idx int:=0;iid uuid;eid uuid;draft jsonb;run jsonb;tasks jsonb:='[]';proof jsonb;changed jsonb;
begin
 w:=public.studio_provision(actor,'Native panel integration',false);
 pref:='{"version":"1.0.0","primary_style":"cinematic_3d","continuity_mode":"fixed","allowed_styles":["cinematic_3d"],"source":"puter","voice_policy":"approved_variants"}';
 bib:='{"kind":"fruits","genre":"mystery","title":"A chave da feira","premise":"Duas frutas encontram uma chave misteriosa na feira.","cast":[{"id":"lia","name":"Lia","appearance":"apple","color":"#ef1234","personality":"Curiosa e amiga de todos.","voice":"female"},{"id":"rui","name":"Rui","appearance":"orange","color":"#fab123","personality":"Impulsivo e muito curioso.","voice":"male"}],"chapters":[{"title":"A chave misteriosa","arc":"Encontram a chave dourada e descobrem quem poderia ter perdido aquele objeto na feira."},{"title":"A porta escondida","arc":"Abrem a porta escondida atrás do portão e descobrem o segredo da feira."}]}';
 perform public.studio_story_claim(w,actor,request,jsonb_build_object('kind','fruits','genre','mystery','chapters',2,'premise',bib->>'premise','presentation',pref));sid:=public.studio_story_save(w,actor,request,bib);
 for c in select value from jsonb_array_elements(bib->'cast') loop
  idx:=idx+1;mid:=gen_random_uuid();r:=public.studio_production_media_reserve(w,actor,sid,mid,c->>'id','reference',repeat(idx::text,64),500,'{"mime":"image/png","width":704,"height":1280}');perform public.studio_production_media_ready(w,actor,mid,repeat(idx::text,64));
  refs:=refs||jsonb_build_array(jsonb_build_object('character_id',c->>'id','path',r->>'path','sha256',repeat(idx::text,64)));
  directions:=directions||jsonb_build_array(jsonb_build_object('character_id',c->>'id','description','Voz adulta em português brasileiro, clara, expressiva e natural.'));
 end loop;
 r:=public.register_story_style_sample(w,jsonb_build_object('id',sample,'style_id','cinematic_3d','source','puter','title','Exemplo nativo de integração','model','MiniMax H3','sha256',repeat('e',64),'bytes',1000,'seconds',15.5,'width',720,'height',1280,'output_fps',30,'native_fps',null,'has_audio',true,'motion','generated','review_scope','reviewed_sample','limitations',jsonb_build_array('A identidade da voz pode variar.')));
 perform public.ready_story_style_sample(w,sample,repeat('e',64));
 profile:=jsonb_build_object('version','puter-native-1.0.0','model','togetherai:wan-ai/wan2.7-i2v','contract_sha256','af3cf52f125272b2daee0361659dec3631a6255acaad234a3e47e02b18415364','style','Animação 3D com expressões legíveis, gestos naturais e a roupa das referências.','orientation','portrait','width',720,'height',1280,'output_fps',30,'references',refs,'voice_directions',directions,'voice_policy','provider_generated_review','native_voice_acknowledged',true,'example',jsonb_build_object('id',sample,'sha256',repeat('e',64)));
 perform pg_temp.native_panel_assert((public.studio_story_pattern_view(w,actor,sid,1,'cinematic_3d')->>'can_configure')::boolean,'native setup accepts images without Edge voice samples');
 perform pg_temp.native_panel_assert(jsonb_array_length(public.studio_story_pattern_view(w,actor,sid,1,'cinematic_3d')->'native_examples')=1,'matching private example visible');
 begin perform public.studio_puter_pattern_finalize(w,outsider,sid,1,'cinematic_3d',profile,repeat('a',64));raise exception 'Outsider fixed native profile';exception when insufficient_privilege then null;end;
 begin perform public.studio_puter_pattern_finalize(w,actor,sid,1,'cinematic_3d',jsonb_set(profile,'{native_voice_acknowledged}','false'),repeat('a',64));raise exception 'Missing voice acknowledgement accepted';exception when check_violation then null;end;
 begin perform public.studio_puter_pattern_finalize(w,actor,sid,1,'cinematic_3d',jsonb_set(profile,'{example,id}',to_jsonb(gen_random_uuid())),repeat('a',64));raise exception 'Unreviewed example accepted';exception when check_violation then null;end;
 perform pg_temp.native_panel_assert(public.studio_puter_pattern_finalize(w,actor,sid,1,'cinematic_3d',profile,repeat('a',64))->>'code'='saved','native pattern saved');
 perform pg_temp.native_panel_assert(public.studio_puter_pattern_finalize(w,actor,sid,1,'cinematic_3d',profile,repeat('a',64))->>'code'='saved','native pattern save idempotent');
 perform pg_temp.native_panel_assert(public.studio_story_next(w,actor,sid)->>'code'='native_setup_required','saving profile does not activate generation');
 update public.system_config set value=value||'{"puter_chapter_enabled":true}' where key='story_production';
 perform pg_temp.native_panel_assert(public.studio_story_next(w,actor,sid)->>'code'='complete_chapter_budget_required','no connected budget never queues a chapter');
 r:=public.studio_puter_connect(w,actor,'fixture-token-only-not-real',jsonb_build_object('provider','puter','account_sha256',repeat('c',64),'checked_at',now(),'remaining_credits',1000,'monthly_allowance',1000,
  'storage_free_bytes',20000000,'unit','credits','financially_eligible',true,'contract_sha256','af3cf52f125272b2daee0361659dec3631a6255acaad234a3e47e02b18415364','budget_basis','empirical_conservative_estimate','provider_quote',false,'blockers','[]'::jsonb));
 perform pg_temp.native_panel_assert(public.studio_story_next(w,actor,sid)->>'code'='queued','complete budget permits only narrative admission');
 perform pg_temp.native_panel_assert(not exists(select 1 from public.studio_puter_runs where workspace_id=w),'queueing does not invoke video or reserve GPU');
end $$;
rollback;
