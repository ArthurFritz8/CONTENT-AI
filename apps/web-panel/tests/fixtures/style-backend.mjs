// Isolated browser-test backend. Never imported by production code.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
if(process.env.STORY_STYLE_TEST_FIXTURE!=='1')throw Error('fixture_only');
Object.assign(process.env,{SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_ANON_KEY:'fixture-anon',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',WEB_PANEL_ALLOWED_USER_IDS:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',APP_URL:'http://localhost:3101'});
const actor='11111111-1111-4111-8111-111111111111',workspace='22222222-2222-4222-8222-222222222222',series='33333333-3333-4333-8333-333333333333';
const defaults={version:'1.0.0',primary_style:'illustrated',continuity_mode:'fixed',allowed_styles:['illustrated'],source:'automatic',voice_policy:'preserve'};
const versions=[{revision:1,effective_from:1,preferences:defaults}];
const patterns=[],media=[],files=new Map();
let nativeChapter=null,cancelRequested=false;
let videoQueueState='prepared';
const videoQueueEpisode='12121212-1212-4212-8212-121212121212',videoQueueId='13131313-1313-4313-8313-131313131313';
const wav=Buffer.alloc(32044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
for(const [index,character_id] of ['lia','rui'].entries()) {
 const id=`44444444-4444-4444-8444-44444444444${index}`,sha256=createHash('sha256').update(wav).digest('hex'),path=`${workspace}/story-profile/${series}/${id}/${sha256}.wav`;
 media.push({id,character_id,kind:'voice_sample',sha256,path,bytes:wav.length,ready:true,metadata:{engine:'edge',version:'edge-tts-7.2.8-rate0',voice_id:index?'pt-BR-AntonioNeural':'pt-BR-FranciscaNeural',mime:'audio/wav',seconds:1}});files.set(path,wav);
}
const bible={kind:'fruits',genre:'mystery',title:'A chave da feira — teste isolado',premise:'Duas frutas encontram uma chave misteriosa na feira e procuram quem perdeu o objeto.',cast:[{id:'lia',name:'Lia',appearance:'apple',color:'#ef1234',personality:'Curiosa e amiga de todos.',voice:'female'},{id:'rui',name:'Rui',appearance:'orange',color:'#fab123',personality:'Impulsivo e curioso.',voice:'male'}],chapters:[{title:'A chave',arc:'Os dois amigos encontram uma chave e descobrem uma pista.'},{title:'A porta',arc:'Abrem a porta e descobrem o segredo da feira.'}]};
const editorial={revision:0,pins:[],memory:{relationships:'',secrets:'',characters:'',setting:'',open_threads:''},guidance:''};
let repaired=false;
let formatShots=3,formatRevision=0;
const formatRequests=new Map();
const samples=JSON.parse(readFileSync(new URL('../../../../docs/stories/style-gallery-samples.json',import.meta.url),'utf8')).map(({sample:{sha256,bytes,...s}})=>({...s,created_at:'2026-10-14T00:00:00Z'}));
// Opaque private-byte fixture: verifies scope/hash transport, not artistic quality.
const nativeBytes=Buffer.from('isolated-native-example-bytes'),nativeHash=createHash('sha256').update(nativeBytes).digest('hex'),nativeExample=samples.find(s=>s.source==='auray');
const samplePath=`${workspace}/story-samples/${nativeExample.id}/${nativeHash}.mp4`;files.set(samplePath,nativeBytes);
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const puterId='abababab-abab-4bab-8bab-abababababab';
const puterView=()=>({enabled:true,accounts:[{id:puterId,remaining_credits:677.7,monthly_allowance:1000,checked_at:new Date().toISOString(),balance_fresh:true,financially_eligible:true,estimated_chapters:0,estimated_seconds:10,reserved:false,busy:false,sync_failed:false,blockers:[]}]});
globalThis.fetch=async(input,init)=>{
 const u=new URL(input instanceof Request? input.url:String(input));
 // Every unexpected request is rejected, including external generation and storage.
 if(u.origin==='https://api.puter.com'){
  if(u.pathname==='/whoami')return json({uuid:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',username:'fixture-puter',subscribed:false,subscription:null,is_temp:false,email_confirmed:true,requires_email_confirmation:false,requires_phone_verification:false,requires_card_verification:false,card_fallback_available:false});
  if(u.pathname==='/metering/usage')return json({allowanceInfo:{remaining:677.7,monthUsageAllowance:1000,unit:'credits',addons:{}}});
  if(u.pathname==='/df')return json({capacity:25000000,used:5000000});
  if(u.pathname==='/drivers/call'&&JSON.parse(String(init.body)).method==='models')return json({success:true,result:[{id:'togetherai:wan-ai/wan2.7-i2v',provider:'together-video-generation',costs_currency:'usd-cents',costs:{'per-second':2},durationSeconds:[5],fps:[30],dimensions:['720P'],ratios:['9:16'],keyframes:['first']}]});
  throw Error('fixture_generation_forbidden');
 }
 if(u.origin!=='https://fixture.supabase.co')throw Error('fixture_egress_denied');
 const body=init?.body && !u.pathname.startsWith('/storage/')?JSON.parse(String(init.body)):{};
 if(u.pathname==='/rest/v1/rpc/studio_video_queue_snapshot') {
    if(body.p_actor!==actor||body.p_workspace!==workspace)throw Error('fixture_queue_foreign_scope');
    return json({entries:videoQueueState==='cancelled'?[]:[{id:videoQueueEpisode,series_id:series,title:'Animacao em espera',chapter_number:1,priority:100,created_at:Date.now()-10000,
     queue_id:videoQueueState==='prepared'?null:videoQueueId,revision:0,state:videoQueueState,profile_sha256:'c'.repeat(64),previous_approved:true,blocked_code:null,
     shots:Array.from({length:5},(_,index)=>({shot:{version:'1.0.0',id:`take_${index}`,kind:'dialogue',reference_path:`${workspace}/private/reference.png`,reference_sha256:'a'.repeat(64),
        audio_path:`${workspace}/private/audio.wav`,audio_sha256:'b'.repeat(64),prompt:'Medium close-up with gentle gestures and clear facial identity.',seconds:3.9375,seed:2007,quality:'approved_master',
        min_short_edge:704,min_output_fps:60,continuity:{series_id:series,profile_sha256:'c'.repeat(64)}},quotes:[]}))}],providers:[],wallets:[],
     queue:{cursor_revision:0,after_quota_group:null,reservation_enabled:false}});
 }
 if(u.pathname==='/rest/v1/rpc/studio_video_enqueue') {
    if(body.p_actor!==actor||body.p_workspace!==workspace||body.p_episode!==videoQueueEpisode||body.p_profile!=='c'.repeat(64))throw Error('fixture_queue_foreign_scope');
    videoQueueState='pending';return json({code:'queued',id:videoQueueId,state:'pending',revision:0});
 }
 if(u.pathname==='/rest/v1/rpc/studio_video_queue_cancel') {
    if(body.p_actor!==actor||body.p_workspace!==workspace||body.p_queue!==videoQueueId)throw Error('fixture_queue_foreign_scope');
    if(body.p_revision!==0)return json({code:'queue_version_changed'});
    videoQueueState='cancelled';return json({code:'cancelled'});
 }
 if(u.pathname==='/rest/v1/rpc/studio_puter_view'){if(body.p_actor!==actor||body.p_workspace!==workspace)throw Error('fixture_puter_foreign_scope');return json(puterView());}
 if(u.pathname==='/rest/v1/rpc/claim_puter_inspection'){if(body.p_actor!==actor||body.p_workspace!==workspace||body.p_account!==puterId)throw Error('fixture_puter_foreign_scope');return json({code:'claimed',credential:'fixture-only-not-a-real-token'});}
 if(u.pathname==='/rest/v1/rpc/finish_puter_inspection'){if(body.p_observation?.financially_eligible!==true||body.p_observation?.remaining_credits!==677.7)throw Error('fixture_invalid_puter_observation');return new Response(null,{status:204});}
 if(u.pathname==='/rest/v1/rpc/studio_story_duration_save') {
  if(body.p_actor!==actor||body.p_workspace!==workspace||body.p_series!==series||![3,6,9].includes(body.p_shots))throw Error('fixture_scope_mismatch');
  if(formatRequests.has(body.p_request))return json(formatRequests.get(body.p_request));
  if(body.p_revision!==formatRevision)return json({code:'revision_changed'});
  formatShots=body.p_shots;formatRevision++;const value={code:'saved',revision:formatRevision,shots:formatShots};formatRequests.set(body.p_request,value);return json(value);
 }
 if(u.pathname==='/rest/v1/rpc/studio_reference_view')return json({connection:null,jobs:[],daily_request_cap:6,remaining_neurons:null});
 if(u.pathname==='/rest/v1/rpc/studio_story_editorial_view')return json({...editorial,bible,cast_locked:false,planned_through:0,seasons:[{number:1,title:'Temporada 1',starts_at:1,ends_at:2}],history:[],storyboards:[]});
 if(u.pathname==='/rest/v1/rpc/studio_story_editorial_save'){
  if(body.p_input.revision!==editorial.revision)return json({code:'revision_changed'});
  Object.assign(bible,body.p_input.bible);Object.assign(editorial,{...body.p_input,revision:editorial.revision+1});return json({code:'saved',revision:editorial.revision});
 }
 if(u.pathname==='/functions/v1/studio-story'&&body.action==='revise')return json({code:'preview',bible:{...bible,chapters:bible.chapters.map(c=>({...c,arc:'A nova pista revela que a carta estava escondida no portão desde o início.'}))}});
 if(u.pathname==='/rest/v1/rpc/studio_native_repair_view'){
  const draft={title:'O segredo da passagem',summary:'Lia encontra a passagem e Rui revela que a guardou para proteger a amiga.',scenes:['Onde está a passagem?','Eu guardei sua passagem.','Por que escondeu isso?'].map((narration_text,index)=>({narration_text,visual:{speaker_id:index===1?'rui':'lia',on_stage:[index===1?'rui':'lia'],setting:'home',mood:'sad'},prompt:'Medium close-up, the reference character makes one clear and restrained gesture.',seed:index+1}))};
  return json({available:true,can_repair:!repaired,draft,versions:repaired?[{source_episode:'88888888-8888-4888-8888-888888888888',episode_id:'77777777-7777-4777-8777-777777777777',shot_index:1,restored:false}]:[],context:{series_id:series,bible,chapter_number:1,previous_summaries:[]},profile:{version:'auray-native-1.0.0',model:'auray-ai/minimax-h3/text-to-video',contract_sha256:'365a74a0aeab67eebf117fd826d540017748d687ba0955fc8ed989d113a816f1',style:'Cinematic 3D characters, clear eyes and natural controlled gestures.',orientation:'portrait',output_fps:24,width:768,height:1344,references:bible.cast.map(c=>({character_id:c.id,path:`${workspace}/story-profile/${series}/${c.id}.png`,sha256:'a'.repeat(64)})),voice_directions:bible.cast.map(c=>({character_id:c.id,description:'Adult Brazilian voice with clear natural emotional delivery.'})),example:{id:nativeExample.id,sha256:nativeHash},voice_policy:'provider_generated_review',native_voice_acknowledged:true}});
 }
 if(u.pathname==='/rest/v1/rpc/studio_native_repair_prepare'){
  if(body.p_edit.index!==1||body.p_draft.scenes[1].seed!==3||body.p_fingerprint.length!==64)throw Error('fixture_invalid_repair');
  repaired=true;
  return json({code:'started',episode_id:'77777777-7777-4777-8777-777777777777',reserved_credits:5});
 }
 if(u.pathname==='/rest/v1/rpc/studio_native_repair_restore'){if(body.p_episode!=='77777777-7777-4777-8777-777777777777')throw Error('fixture_restore_wrong_target');repaired=false;return json({code:'restored'});}
 if(u.pathname.startsWith('/storage/v1/object/studio-private/')) {
  const path=decodeURIComponent(u.pathname.slice('/storage/v1/object/studio-private/'.length));
  if(init?.method==='POST'){if(files.has(path))return new Response(null,{status:409});files.set(path,Buffer.from(init.body));return json({});}
  return files.has(path)?new Response(files.get(path)):new Response(null,{status:404});
 }
 if(u.pathname==='/auth/v1/user')return json({id:actor,email:'fixture@example.invalid',email_confirmed_at:'2026-10-14T00:00:00Z'});
 if(u.pathname==='/rest/v1/studio_members')return json([{workspace_id:workspace}]);
 if(u.pathname==='/rest/v1/studio_workspaces')return json([{name:'Studio de teste isolado'}]);
 if(u.pathname==='/rest/v1/episodes')return json([{id:'88888888-8888-4888-8888-888888888888',status:'rendered',briefing:{text:'Capítulo com avisos de revisão'},metadata:{render_outputs:{sha256:'a'.repeat(64)}},script_json:{metadata:{youtube:{title:'Capítulo com avisos'}},fiction:{native_animation:{},context:{bible}},scenes:[]}}]);
 if(['/rest/v1/job_events','/rest/v1/publishes','/rest/v1/assets','/rest/v1/review_requests'].includes(u.pathname))return json([]);
 if(u.pathname==='/rest/v1/rpc/studio_native_media_review')return json({version:'native-media-review-v1',episode_id:'88888888-8888-4888-8888-888888888888',video_sha256:'a'.repeat(64),created_at:'2026-10-15T12:00:00Z',speech_engine:'faster-whisper-base-cpu',model_revision:'ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66',human_review_required:true,lip_sync_verified:false,identity_verified:false,source_video_unchanged:true,takes:[0,1,2].map(index=>({index,speaker:index===1?'rui':'lia',sha256:String(index+1).repeat(64),expected_text:'Onde está a passagem?',recognized_text:'Ah, onde está a passagem?',speech_status:index<2?'possible_extra_speech':'no_mismatch_detected',appearance_status:index===2?'possible_color_shift':'no_color_shift_detected',sampled_frames:6,color_shift_score:index===2?.57:.10}))});
 if(u.pathname==='/functions/v1/studio-story' && body.action==='capacity')return json({estimated_script_capacity:3});
 if(u.pathname==='/functions/v1/studio-story' && body.action==='native') {if(body.operation==='cancel')cancelRequested=true;return json({code:'waiting_for_runner'});}
 if(u.pathname==='/rest/v1/rpc/studio_story_style_gallery')return json(samples);
 if(u.pathname==='/rest/v1/rpc/studio_video_overview')return json({puter:puterView(),wallets:[{id:'99999999-9999-4999-8999-999999999999',label:'Auray fixture',unit:'credits',remaining_units:50,reserved_units:5,available_units:45,balance_fresh:true,native_enabled:true,budget_only_shots:9,native_budget_chapters:3,source_blockers:[]}],series_profiles:[],patterns:patterns.map(({profile,...p})=>p),preparation_enabled:false,native_enabled:true,native_chapters:nativeChapter?[{episode_id:nativeChapter.episode_id,total_shots:3,completed_shots:0,planned_seconds:15,output_fps:24,stage:cancelRequested?'cancellation_pending':'awaiting_capacity',cancel_requested:cancelRequested,closed:false,last_code:null}]:[]});
 if(u.pathname==='/rest/v1/rpc/studio_animated_progress')return json({chapters:[]});
 if(u.pathname==='/rest/v1/rpc/studio_story_overview')return json({series:[{id:series,bible,native_shots:formatShots,native_format_revision:formatRevision,chapters:nativeChapter?[nativeChapter]:[],presentation:versions.at(-1),presentation_history:versions}],daily_cap:3,daily_remaining:3,generated_today:0,active:nativeChapter?1:0,proposals_remaining:3});
 if(u.pathname==='/rest/v1/rpc/studio_story_next_presented'){if(!nativeChapter)nativeChapter={number:1,native_shots:formatShots,idea_id:'66666666-6666-4666-8666-666666666666',revision:1,idea_status:'pending',episode_id:null,status:null,approved:false,style_id:'cinematic_3d',presentation_revision:versions.at(-1).revision};return json({code:'queued',chapter_number:1,idea_id:nativeChapter.idea_id});}
 if(u.pathname==='/rest/v1/rpc/studio_command' && body.p_action==='generate_video'){nativeChapter={...nativeChapter,episode_id:'77777777-7777-4777-8777-777777777777',idea_status:'consumed',status:'research'};return json({code:'started',episode_id:nativeChapter.episode_id});}
 if(u.pathname==='/rest/v1/rpc/studio_story_presentation_save'){
  if(body.p_actor!==actor || body.p_workspace!==workspace || body.p_series!==series || body.p_confirmed!==true)throw Error('fixture_scope_mismatch');
  if(body.p_expected!==versions.at(-1).revision)return json({code:'style_changed'});
  const v={revision:versions.length+1,effective_from:1,preferences:body.p_preferences};versions.push(v);return json({code:'saved',...v});
 }
 if(u.pathname==='/rest/v1/rpc/studio_story_pattern_view')return json({bible,source:versions.at(-1).preferences.source,voice_policy:versions.at(-1).preferences.voice_policy,native_enabled:true,native_examples:body.p_style===nativeExample.style_id?[nativeExample]:[],media:media.filter(m=>m.ready),profile:patterns.find(p=>p.revision===body.p_revision&&p.style_id===body.p_style)?.profile||null,can_configure:!patterns.some(p=>p.revision===body.p_revision&&p.style_id===body.p_style),voice_enabled:true,voice_state:'ready'});
 if(u.pathname==='/rest/v1/rpc/studio_story_style_media')return json({path:samplePath,bytes:nativeBytes.length,sha256:nativeHash});
 if(u.pathname==='/rest/v1/rpc/studio_native_pattern_finalize'){
  if(body.p_profile.native_voice_acknowledged!==true || body.p_profile.voice_policy!=='provider_generated_review' || body.p_profile.voice_directions.length!==2 || body.p_profile.example.sha256!==nativeHash)throw Error('fixture_invalid_native_consent');
  patterns.push({series_id:series,revision:body.p_revision,style_id:body.p_style,profile_sha256:body.p_hash,profile:body.p_profile});return json({code:'saved'});
 }
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
