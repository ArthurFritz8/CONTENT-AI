import {test,expect} from '@playwright/test';
test('queue API requires a verified session',async({request})=>{
 const response=await request.get('/api/stories/queue');expect(response.status()).toBe(401);
});
test('prepared chapter persists in queue without reserve or dispatch and can be cancelled',async({page,context})=>{
 await context.addCookies([{name:'fritz_session',value:'fixture-token',domain:'localhost',path:'/'}]);
 await page.route('**/api/control?*',route=>route.fulfill({json:{items:[],total:0,page:1}}));
 await page.route('**/api/discovery',route=>route.fulfill({json:{items:[]}}));
 await page.goto('/studio/queue');const queue=page.getByRole('region',{name:'Fila de animação'});
 const generic=queue.locator('.video-queue-list > li').filter({has:page.getByRole('link',{name:'Animacao em espera · capítulo 1'})});
 await expect(queue.getByText('Reservas desativadas',{exact:true})).toBeVisible();
 await generic.getByRole('button',{name:'Adicionar à fila'}).click();
 await expect(queue.getByText('Aguardando fonte ou saldo confirmado',{exact:true})).toBeVisible();
 await page.reload();await expect(queue.getByText('Aguardando fonte ou saldo confirmado',{exact:true})).toBeVisible();
 const response=await page.request.get('/api/stories/queue');expect(response.status()).toBe(200);const result=await response.json();
 expect(result.dispatch_enabled).toBe(false);expect(result.reservation_enabled).toBe(false);
 expect(JSON.stringify(result)).not.toMatch(/private\/|audio_sha256|reference_sha256|profile_sha256|shots|quotes/);
 for(const data of [{action:'reserve'},{action:'enqueue',episodeId:result.items[0].episode_id,requestId:crypto.randomUUID(),p_workspace:'33333333-3333-4333-8333-333333333333'}]) {
  const denied=await page.request.post('/api/stories/queue',{headers:{Origin:'http://localhost:3101'},data});expect(denied.status()).toBe(400);
 }
 const foreign=await page.request.post('/api/stories/queue',{headers:{Origin:'https://foreign.invalid'},data:{action:'cancel',queueId:result.items[0].queue_id,revision:0}});expect(foreign.status()).toBe(403);
 const foreignEpisode=await page.request.post('/api/stories/queue',{headers:{Origin:'http://localhost:3101'},data:{action:'enqueue',episodeId:'99999999-9999-4999-8999-999999999999',requestId:crypto.randomUUID()}});expect(foreignEpisode.status()).toBe(409);
 await queue.screenshot({path:'test-results/video-queue-desktop.png',animations:'disabled'});
 await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await queue.screenshot({path:'test-results/video-queue-mobile.png',animations:'disabled'});
 await queue.getByRole('button',{name:'Cancelar entrada de Animacao em espera'}).click();
 await expect(queue.getByRole('link',{name:'Animacao em espera · capítulo 1'})).toHaveCount(0);
});
test('Puter chapter stays in its native queue with insufficient full-chapter budget and no generation',async({page,context})=>{
 await context.addCookies([{name:'fritz_session',value:'fixture-token',domain:'localhost',path:'/'}]);
 await page.route('**/api/control?*',route=>route.fulfill({json:{items:[],total:0,page:1}}));
 await page.route('**/api/discovery',route=>route.fulfill({json:{items:[]}}));
 await page.goto('/studio/queue');const queue=page.getByRole('region',{name:'Fila de animação'});
 const native=queue.locator('.video-queue-list > li').filter({has:page.getByRole('link',{name:'Novela Puter em espera · capítulo 1'})});
 await expect(native.getByText('Saldo Puter insuficiente para o capítulo inteiro',{exact:false}).first()).toBeVisible();
 await expect(native.getByText('990 créditos estimados para 15s',{exact:false})).toBeVisible();
 await expect(native.getByText('677,7 créditos disponíveis nesta previsão',{exact:false})).toBeVisible();
 await native.getByRole('button',{name:'Adicionar à fila'}).click();await page.reload();
 await expect(native.getByRole('button',{name:'Adicionar à fila'})).toHaveCount(0);
 await expect(native.getByText('Saldo Puter insuficiente para o capítulo inteiro',{exact:false}).first()).toBeVisible();
 const response=await page.request.get('/api/stories/queue'),result=await response.json();
 expect(result.estimated_complete_chapters).toBe(0);expect(result.dispatch_enabled).toBe(false);
 expect(JSON.stringify(result)).not.toMatch(/profile_sha256|fingerprint|credential|account_sha256|remote_filename/);
 const accounts=await (await page.request.get('/api/stories/puter')).json();expect(accounts.accounts[0].reserved).toBe(false);
 await native.screenshot({path:'test-results/puter-queue-desktop.png',animations:'disabled'});
 await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await native.screenshot({path:'test-results/puter-queue-mobile.png',animations:'disabled'});
 await native.getByRole('button',{name:'Cancelar entrada de Novela Puter em espera'}).click();
 await expect(native).toHaveCount(0);
});
test('queue read failure is explicit rather than a false empty queue',async({page,context})=>{
 await context.addCookies([{name:'fritz_session',value:'fixture-token',domain:'localhost',path:'/'}]);
 await page.route('**/api/control?*',route=>route.fulfill({json:{items:[],total:0,page:1}}));
 await page.route('**/api/discovery',route=>route.fulfill({json:{items:[]}}));
 await page.route('**/api/stories/queue',route=>route.fulfill({status:503,json:{error:'Fila temporariamente indisponível.'}}));
 await page.goto('/studio/queue');const queue=page.getByRole('region',{name:'Fila de animação'});
 await expect(queue.getByRole('alert')).toContainText('Fila temporariamente indisponível.');
 await expect(queue.getByText('Nenhum capítulo preparado aguardando nesta fila.')).toHaveCount(0);
});
test('planning-only pilot exposes dialogue for review and no execution command',async({page,context})=>{
 await context.addCookies([{name:'fritz_session',value:'fixture-token',domain:'localhost',path:'/'}]);
 await page.route('**/api/control?*',route=>route.fulfill({json:{items:[],total:0,page:1}}));
 await page.route('**/api/discovery',route=>route.fulfill({json:{items:[]}}));
 await page.goto('/studio/queue');const queue=page.getByRole('region',{name:'Fila de animação'});
 const pilot=queue.locator('.video-queue-list > li').filter({has:page.getByRole('link',{name:'Piloto somente planejamento · capítulo 1'})});
 await expect(pilot.getByText('Somente planejamento · execução bloqueada',{exact:false}).first()).toBeVisible();
 await expect(pilot.getByRole('list',{name:'Falas planejadas de Piloto somente planejamento'}).getByRole('listitem')).toHaveCount(3);
 await expect(pilot.getByRole('button',{name:/gerar|executar|reservar|ativar/i})).toHaveCount(0);
 await expect(pilot.getByText('Você ia embora sem mim?',{exact:false})).toBeVisible();
 await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await pilot.screenshot({path:'test-results/puter-planning-pilot-mobile.png',animations:'disabled'});
});
test('approved preview is available privately with approval scope and responsive player',async({page,context})=>{
 await context.addCookies([{name:'fritz_session',value:'fixture-token',domain:'localhost',path:'/'}]);
 await page.route('**/api/control?*',route=>route.fulfill({json:{items:[],total:0,page:1}}));
 await page.route('**/api/discovery',route=>route.fulfill({json:{items:[]}}));
 await page.goto('/studio/queue');const previews=page.getByRole('region',{name:'Prévias aprovadas'});
 await expect(previews.getByRole('heading',{name:'Laranjito - prévia aprovada'})).toBeVisible();
 await expect(previews.getByText('Aprovação limitada a esta prévia.',{exact:false})).toBeVisible();
 const player=previews.getByLabel('Laranjito - prévia aprovada');await expect(player).toHaveAttribute('preload','none');
 const response=await page.request.get('/api/stories/styles/media?id=20202020-2020-4020-8020-202020202020');
 expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toBe('private, no-store');
 if(process.env.STORY_STYLE_REAL_PREVIEW==='1') {
  await player.evaluate((element:HTMLVideoElement)=>{element.muted=true;return element.play();});
  await expect.poll(()=>player.evaluate((element:HTMLVideoElement)=>element.videoWidth)).toBe(720);
  await expect.poll(()=>player.evaluate((element:HTMLVideoElement)=>element.currentTime)).toBeGreaterThan(0);
  await player.evaluate((element:HTMLVideoElement)=>element.pause());
 }
 await previews.screenshot({path:'test-results/approved-previews-desktop.png',animations:'disabled'});
 await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await previews.screenshot({path:'test-results/approved-previews-mobile.png',animations:'disabled'});
});
test('planning-only story has no resume control and does not consume generation counters',async({page,context})=>{
 await context.addCookies([{name:'fritz_session',value:'fixture-token',domain:'localhost',path:'/'}]);
 await page.route('**/api/control?*',route=>route.fulfill({json:{items:[],total:0,page:1}}));
 await page.route('**/api/discovery',route=>route.fulfill({json:{items:[]}}));
 await page.route('**/api/stories',async route=>{
  const response=await route.fetch(),data=await response.json();
  Object.assign(data,{active:0,generated_today:0,daily_remaining:3,planning:1});
  data.series[0].chapters=[{number:1,idea_id:'61616161-6161-4161-8161-616161616161',revision:0,idea_status:'consumed',episode_id:'17171717-1717-4717-8717-171717171717',status:'research',approved:false}];
  data.videoCapacity.native_chapters=[{episode_id:'17171717-1717-4717-8717-171717171717',stage:'planning_only',completed_shots:0,total_shots:3,planned_seconds:15,output_fps:30,closed:false,cancel_requested:false}];
  await route.fulfill({response,json:data});
 });
 await page.goto('/studio/queue');await page.getByRole('button',{name:'Novela de frutas',exact:false}).click();
 await expect(page.getByText('0/3 do limite diário de geração utilizado · 1 em planejamento, sem geração.',{exact:false})).toBeVisible();
 const story=page.locator('article.panel').filter({has:page.getByRole('heading',{name:'A chave da feira — teste isolado'})});
 await expect(story.getByText('Somente planejamento · execução bloqueada',{exact:true})).toBeVisible();
 await expect(story.getByRole('button',{name:'Retomar acompanhamento'})).toHaveCount(0);
});
test('HQ local requires explicit local source and voice consent without replacing native styles',async({page,context})=>{
 await context.addCookies([{name:'fritz_session',value:'fixture-token',domain:'localhost',path:'/'}]);
 await page.route('**/api/control?*',route=>route.fulfill({json:{items:[],total:0,page:1}}));
 await page.route('**/api/discovery',route=>route.fulfill({json:{items:[]}}));
 let proposed=false;
 await page.route('**/api/stories',async route=>{
  if(route.request().method()==='POST') {
   const body=route.request().postDataJSON();expect(body.action).toBe('propose');expect(body.input.presentation.source).toBe('local');
    expect(body.input.presentation.primary_style).toBe('motion_comic');expect(body.input.presentation.voice_policy).toBe('preserve');expect(body.input.local_voice_acknowledged).toBe(true);
   proposed=true;await route.fulfill({json:{code:'created'}});
  }else await route.continue();
 });
 await page.goto('/studio/queue');await page.getByRole('button',{name:'Novela de frutas',exact:false}).click();
 const selector=page.getByRole('group',{name:'Escolha como sua novela vai parecer'}).first();
 const comic=selector.locator('article').filter({has:page.getByRole('heading',{name:'HQ com voz'})});
 await comic.getByRole('button',{name:'Planejar neste estilo'}).click();await selector.getByLabel('Fonte de geração').selectOption('local');
 await expect(selector.getByText('Não gera vídeo 3D ou movimento de boca.',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Criar novela automaticamente',exact:false}).first().click();
 const submit=page.getByRole('button',{name:'Criar novela automaticamente',exact:true});
 const buttonCount=await submit.count();expect(buttonCount).toBeGreaterThan(0);
 await submit.last().click();await expect(page.getByRole('alert').filter({hasText:'Confirme as vozes ilustradas'})).toBeVisible();expect(proposed).toBe(false);
 await page.getByLabel('Escolhi HQ local e aceito as vozes ilustradas Francisca e Antonio',{exact:false}).check();
 await submit.last().click();await expect.poll(()=>proposed).toBe(true);
 await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await comic.screenshot({path:'test-results/local-comic-choice-mobile.png',animations:'disabled'});
});