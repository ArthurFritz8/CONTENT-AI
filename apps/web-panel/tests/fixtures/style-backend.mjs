// Isolated browser-test backend. Never imported by production code.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
if(process.env.STORY_STYLE_TEST_FIXTURE!=='1')throw Error('fixture_only');
Object.assign(process.env,{SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_ANON_KEY:'fixture-anon',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',WEB_PANEL_ALLOWED_USER_IDS:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',APP_URL:'http://localhost:3101'});
const actor='11111111-1111-4111-8111-111111111111',workspace='22222222-2222-4222-8222-222222222222',series='33333333-3333-4333-8333-333333333333';
const defaults={version:'1.0.0',primary_style:'illustrated',continuity_mode:'fixed',allowed_styles:['illustrated'],source:'automatic',voice_policy:'preserve'};
const versions=[{revision:1,effective_from:1,preferences:defaults}];
const patterns=[],media=[],files=new Map();
const wav=Buffer.alloc(32044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
for(const [index,character_id] of ['lia','rui'].entries()) {
 const id=`44444444-4444-4444-8444-44444444444${index}`,sha256=createHash('sha256').update(wav).digest('hex'),path=`${workspace}/story-profile/${series}/${id}/${sha256}.wav`;
 media.push({id,character_id,kind:'voice_sample',sha256,path,bytes:wav.length,ready:true,metadata:{engine:'edge',version:'edge-tts-7.2.8-rate0',voice_id:index?'pt-BR-AntonioNeural':'pt-BR-FranciscaNeural',mime:'audio/wav',seconds:1}});files.set(path,wav);
}
const bible={kind:'fruits',genre:'mystery',title:'A chave da feira — teste isolado',premise:'Duas frutas encontram uma chave misteriosa na feira e procuram quem perdeu o objeto.',cast:[{id:'lia',name:'Lia',appearance:'apple',color:'#ef1234',personality:'Curiosa e amiga de todos.',voice:'female'},{id:'rui',name:'Rui',appearance:'orange',color:'#fab123',personality:'Impulsivo e curioso.',voice:'male'}],chapters:[{title:'A chave',arc:'Os dois amigos encontram uma chave e descobrem uma pista.'},{title:'A porta',arc:'Abrem a porta e descobrem o segredo da feira.'}]};
const samples=JSON.parse(readFileSync(new URL('../../../../docs/stories/style-gallery-samples.json',import.meta.url),'utf8')).map(({sample:{sha256,bytes,...s}})=>({...s,created_at:'2026-10-14T00:00:00Z'}));
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
globalThis.fetch=async(input,init)=>{
 const u=new URL(input instanceof Request? input.url:String(input));
 // Every unexpected request is rejected, including external generation and storage.
 if(u.origin!=='https://fixture.supabase.co')throw Error('fixture_egress_denied');
 const body=init?.body && !u.pathname.startsWith('/storage/')?JSON.parse(String(init.body)):{};
 if(u.pathname.startsWith('/storage/v1/object/studio-private/')) {
  const path=decodeURIComponent(u.pathname.slice('/storage/v1/object/studio-private/'.length));
  if(init?.method==='POST'){if(files.has(path))return new Response(null,{status:409});files.set(path,Buffer.from(init.body));return json({});}
  return files.has(path)?new Response(files.get(path)):new Response(null,{status:404});
 }
 if(u.pathname==='/auth/v1/user')return json({id:actor,email:'fixture@example.invalid',email_confirmed_at:'2026-10-14T00:00:00Z'});
 if(u.pathname==='/rest/v1/studio_members')return json([{workspace_id:workspace}]);
 if(u.pathname==='/rest/v1/studio_workspaces')return json([{name:'Studio de teste isolado'}]);
 if(u.pathname==='/functions/v1/studio-story' && body.action==='capacity')return json({estimated_script_capacity:3});
 if(u.pathname==='/rest/v1/rpc/studio_story_style_gallery')return json(samples);
 if(u.pathname==='/rest/v1/rpc/studio_video_overview')return json({wallets:[],series_profiles:[],patterns:patterns.map(({profile,...p})=>p),preparation_enabled:false});
 if(u.pathname==='/rest/v1/rpc/studio_animated_progress')return json({chapters:[]});
 if(u.pathname==='/rest/v1/rpc/studio_story_overview')return json({series:[{id:series,bible,chapters:[],presentation:versions.at(-1),presentation_history:versions}],daily_cap:3,daily_remaining:3,generated_today:0,active:0,proposals_remaining:3});
 if(u.pathname==='/rest/v1/rpc/studio_story_presentation_save'){
  if(body.p_actor!==actor || body.p_workspace!==workspace || body.p_series!==series || body.p_confirmed!==true)throw Error('fixture_scope_mismatch');
  if(body.p_expected!==versions.at(-1).revision)return json({code:'style_changed'});
  const v={revision:versions.length+1,effective_from:1,preferences:body.p_preferences};versions.push(v);return json({code:'saved',...v});
 }
 if(u.pathname==='/rest/v1/rpc/studio_story_pattern_view')return json({bible,media:media.filter(m=>m.ready),profile:patterns.find(p=>p.revision===body.p_revision&&p.style_id===body.p_style)?.profile||null,can_configure:!patterns.some(p=>p.revision===body.p_revision&&p.style_id===body.p_style),voice_enabled:true,voice_state:'ready'});
 if(u.pathname==='/rest/v1/rpc/studio_production_media_reserve'){
  const row={id:body.p_id,character_id:body.p_character,kind:body.p_kind,sha256:body.p_sha,bytes:body.p_bytes,metadata:body.p_metadata,path:`${workspace}/story-profile/${series}/${body.p_id}/${body.p_sha}.png`,ready:false};media.push(row);return json(row);
 }
 if(u.pathname==='/rest/v1/rpc/studio_production_media_ready') {media.find(m=>m.id===body.p_id).ready=true;return new Response(null,{status:204});}
 if(u.pathname==='/rest/v1/rpc/studio_production_media_read')return json(media.find(m=>m.id===body.p_id&&m.ready));
 if(u.pathname==='/rest/v1/rpc/studio_story_pattern_finalize'){
  if(body.p_revision!==versions.at(-1).revision || body.p_profile.voices.length!==2 || body.p_profile.references.length!==2)throw Error('fixture_invalid_pattern');
  patterns.push({series_id:series,revision:body.p_revision,style_id:body.p_style,profile_sha256:body.p_hash,profile:body.p_profile});return json({code:'saved'});
 }
 throw Error('fixture_unexpected_request');
};
