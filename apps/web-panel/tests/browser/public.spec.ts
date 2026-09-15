import {test,expect} from '@playwright/test';
test('language and theme persist on public and login routes',async({page})=>{
  await page.goto('/login');await expect(page.getByRole('button',{name:'Entrar no painel',exact:true})).toBeEnabled();
  await page.getByLabel('Idioma',{exact:true}).selectOption('en');
  await expect(page.getByRole('heading',{name:'Welcome to the Studio'})).toBeVisible();
  await page.getByRole('button',{name:'Dark',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.reload();await expect(page.getByRole('heading',{name:'Welcome to the Studio'})).toBeVisible();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByLabel('Language',{exact:true}).selectOption('es');await expect(page.getByRole('heading',{name:'Bienvenido al Studio'})).toBeVisible();
  await page.getByRole('button',{name:'Claro',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.goto('/');await expect(page.getByRole('heading',{name:'Del descubrimiento al próximo play.'})).toBeVisible();
});
test('credentials never fall back to a GET submission before hydration',async({browser})=>{
  const context=await browser.newContext({javaScriptEnabled:false});const page=await context.newPage();await page.goto('/login');
  await expect(page.locator('form')).toHaveAttribute('method','post');await expect(page.locator('form')).toHaveAttribute('action','/api/session');
  await expect(page.locator('form button')).toBeDisabled();await context.close();
});
test('anonymous and cross-origin requests cannot access or mutate data',async({request})=>{
  const read=await request.get('/api/control');expect(read.status()).toBe(401);
  const wrongOrigin=await request.post('/api/control',{headers:{Origin:'https://attacker.invalid'},data:{action:'pipeline'}});expect(wrongOrigin.status()).toBe(403);
  const anonymousWrite=await request.post('/api/control',{headers:{Origin:'http://localhost:3100'},data:{action:'pipeline'}});expect(anonymousWrite.status()).toBe(401);
});
test('mobile login has usable language controls and no page overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/login');await expect(page.getByRole('button',{name:'Entrar no painel',exact:true})).toBeEnabled();
  await expect(page.getByLabel('Idioma',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
