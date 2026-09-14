// Real FFmpeg + renderer CLI against an in-memory Storage/PostgREST fixture. No cloud credentials.
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const dir=await mkdtemp(join(tmpdir(),'content-ai-render-test-'));
const id='22222222-2222-4222-8222-222222222222';
const objects=new Map();
const events=[];
let base;
let episode;
const server=createServer(async (req,res)=>{
  const url=new URL(req.url,base);
  const chunks=[];
  for await (const chunk of req) chunks.push(chunk);
  const bytes=Buffer.concat(chunks);
  res.setHeader('Content-Type','application/json');
  if (url.pathname==='/rest/v1/episodes') {
    if(req.method==='PATCH') { if(episode.status==='assets') Object.assign(episode,JSON.parse(bytes)); res.writeHead(204).end(); }
    else res.end(JSON.stringify([episode]));
  } else if(url.pathname==='/rest/v1/system_config') res.end(JSON.stringify([{value:{storage_bucket:'assets',preset:'ultrafast',cleanup_tmp:true}}]));
  else if(url.pathname==='/rest/v1/assets') res.end(JSON.stringify([0,1,2].map(scene=>({type:'audio',url:`${base}/audio.wav`,metadata:{scene_order:scene}}))));
  else if(url.pathname==='/rest/v1/job_events') { events.push(JSON.parse(bytes));res.writeHead(201).end(); }
  else if(url.pathname==='/audio.wav') { res.setHeader('Content-Type','audio/wav'); res.end(await readFile(join(dir,'audio.wav'))); }
  else if(url.pathname==='/image.png') { res.setHeader('Content-Type','image/png');res.end(await readFile(join(dir,'image.png'))); }
  else if(url.pathname.startsWith('/storage/v1/object/')) {
    const key=decodeURIComponent(url.pathname.replace('/storage/v1/object/public/','').replace('/storage/v1/object/',''));
    if(req.method==='POST') { objects.set(key,bytes);res.end('{}'); }
    else if(objects.has(key)) res.end(req.method==='HEAD'?undefined:objects.get(key));
    else res.writeHead(404).end('{}');
  } else res.writeHead(404).end('{}');
});
try {
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=320x240','-frames:v','1',join(dir,'image.png')]);
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.713',join(dir,'audio.wav')]);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const asset={url:`${base}/image.png`,license:'own',source:'manual'};
  episode={id,status:'assets',metadata:{},render_url:null,script_json:{
    episode_id:id,prompt_version:'1.0.0',gap_seconds:0.3,music:null,
    narration:{full_text:'Teste de áudio.',language:'pt-BR',estimated_duration_seconds:60},
    metadata:{youtube:{title:'Teste',description:'Teste',tags:['teste'],category:'Education'},tiktok:{title:'Teste',description:'Teste',hashtags:['#teste']}},
    sources:[{claim:'Fixture',source_url:'https://example.com'}],disclosures:{contains_synthetic_media:true,commercial_content:false,commercial_disclosure_text:null},
    scenes:['hook','content','cta'].map((role,order)=>({id:`s${order}`,order,role,duration_seconds:20,narration_text:'Teste de áudio.',transition:'cut',ken_burns:'static',visual:{description:'Azul',search_query:'blue'},highlight_words:[],asset_landscape:asset,asset_portrait:asset,subtitle_position:'bottom_center'})),
  }};
  const run=()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--experimental-strip-types','apps/local-renderer/src/render.ts','--episode-id',id],{
      env:{...process.env,SUPABASE_URL:base,SUPABASE_SERVICE_ROLE_KEY:'fixture-only'},stdio:['ignore','pipe','pipe']});
    let output='';child.stderr.on('data',chunk=>output+=chunk);child.on('error',reject);
    child.on('close',code=>code===0?resolve():reject(new Error(output.slice(-6000))));
  });
  await run();
  assert.equal(episode.status,'rendered');
  assert.equal(objects.size,8); // six intermediate scenes + two finals
  for(const orientation of ['portrait','landscape']) {
    const quality=episode.metadata.render_outputs.quality[orientation];
    assert.equal(quality.decode_verified,true);
    assert.ok(Math.abs(quality.duration_seconds-3)<0.25);
    assert.equal(quality.warnings.length,1); // real audio is shorter than the editorial target
    const path=join(dir,`${orientation}.mp4`);
    const outputUrl=new URL(episode.metadata.render_outputs[orientation]);
    const objectPath=decodeURIComponent(outputUrl.pathname.split('/storage/v1/object/public/')[1]);
    assert.match(objectPath,/\/render\/final\/[a-f0-9]{64}\//);
    assert.equal(objectPath.split('/').at(-2),createHash('sha256').update(objects.get(objectPath)).digest('hex'));
    await writeFile(path,objects.get(objectPath));
    const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path],{encoding:'utf8'}));
    const video=probe.streams.find(stream=>stream.codec_type==='video');
    assert.equal(video.width,orientation==='portrait'?1080:1920);
    assert.ok(Math.abs(Number(probe.format.duration)-3)<0.25);
    assert.ok(probe.streams.some(stream=>stream.codec_type==='audio'));
  }
  episode.status='assets';
  await run();
  assert.equal(events.filter(event=>event.event_type==='render_checkpoint_saved'&&event.metadata.skipped).length,3);
  const completedBefore=events.filter(event=>event.event_type==='render_completed').length;
  const finalsBefore=[...objects.keys()].filter(key=>key.includes('/render/final/'));
  // Simulate readable MP4 checkpoints whose audio track was lost in Storage.
  for(const [key,bytes] of objects) {
    if(key.includes('/render/final/')) continue;
    const input=join(dir,'checkpoint.mp4'), output=join(dir,'silent.mp4');
    await writeFile(input,bytes);
    execFileSync('ffmpeg',['-y','-v','error','-i',input,'-c:v','copy','-an',output]);
    objects.set(key,await readFile(output));
  }
  episode.status='assets';
  await assert.rejects(run(),/QA audiovisual/);
  assert.equal(episode.status,'failed');
  assert.equal(events.filter(event=>event.event_type==='render_completed').length,completedBefore);
  assert.deepEqual([...objects.keys()].filter(key=>key.includes('/render/final/')),finalsBefore);
  console.log('FFmpeg real: dois formatos, QA com decode, retomada e bloqueio de checkpoints sem áudio aprovados.');
} finally { server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true}); }
