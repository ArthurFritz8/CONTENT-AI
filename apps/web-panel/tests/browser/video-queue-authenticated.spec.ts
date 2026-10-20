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
 await expect(native.getByText('Saldo Puter insuficiente para o capítulo inteiro',{exact:false})).toBeVisible();
 await expect(native.getByText('990 créditos estimados para 15s',{exact:false})).toBeVisible();
 await expect(native.getByText('677,7 créditos disponíveis nesta previsão',{exact:false})).toBeVisible();
 await native.getByRole('button',{name:'Adicionar à fila'}).click();await page.reload();
 await expect(native.getByRole('button',{name:'Adicionar à fila'})).toHaveCount(0);
 await expect(native.getByText('Saldo Puter insuficiente para o capítulo inteiro',{exact:false})).toBeVisible();
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
 await expect(pilot.getByText('Somente planejamento · execução bloqueada',{exact:false})).toBeVisible();
 await expect(pilot.getByRole('list',{name:'Falas planejadas de Piloto somente planejamento'}).getByRole('listitem')).toHaveCount(3);
 await expect(pilot.getByRole('button',{name:/gerar|executar|reservar|ativar/i})).toHaveCount(0);
 await expect(pilot.getByText('Você ia embora sem mim?',{exact:false})).toBeVisible();
 await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await pilot.screenshot({path:'test-results/puter-planning-pilot-mobile.png',animations:'disabled'});
});