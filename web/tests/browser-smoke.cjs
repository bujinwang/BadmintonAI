// Optional real-browser integration check. Uses an existing Playwright installation.
// Serve web/out on port 8080, then PLAYWRIGHT_MODULE=/path/to/playwright-core node web/tests/browser-smoke.cjs
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
(async()=>{
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const base=process.env.BASE_URL || 'http://127.0.0.1:8080';
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());

 await page.goto(base+'/m/india_open_2022_final/ai/film/?r=1-2');
 await page.getByRole('button',{name:'Next rally →',exact:true}).waitFor();
 await page.getByRole('button',{name:'Next rally →',exact:true}).click();
 await page.waitForURL('**r=1-3');assert(await page.getByText('Set 1 · Rally 3',{exact:true}).isVisible());
 await page.goBack();await page.waitForURL('**r=1-2');assert(await page.getByText('Set 1 · Rally 2',{exact:true}).isVisible());
 await page.getByRole('combobox').first().selectOption('2');await page.waitForURL('**set=2');
 assert.equal(await page.getByRole('combobox').first().inputValue(),'2');
 await page.goBack(); await page.waitForURL('**r=1-2');assert.equal(await page.getByRole('combobox').first().inputValue(),'All');
 console.log('PASS selection/filter history');
 await page.goto(base+'/m/india_open_2022_final/ai/film/?set=999');
 await page.getByRole('button',{name:'Show all rallies'}).click();
 await page.getByRole('button',{name:'Next rally →',exact:true}).waitFor();
 assert.equal(new URL(page.url()).search,'');
 console.log('PASS empty filters reset');
 await page.goto(base+'/m/india_open_2022_final/ai/film/?r=1-2&keys=1-2&title=Example');
 await page.locator('a[href="/m/india_open_2022_final/labels/film/"]').click();
 await page.waitForURL('**/labels/film/');assert.equal(new URL(page.url()).search,'');
 console.log('PASS source switch clears source-specific evidence');
 // A pending new rally must remove the previous replay, not display mismatched footage/tracks.
 await page.goto(base+'/m/india_open_2022_final/ai/film/?r=1-1');
 await page.locator('[data-playback="video"]').waitFor();
 let release; const gate=new Promise(done=>release=done);
 await page.route('**/replay/ai/s1r7.json',async route=>{await gate;await route.continue()});
 await page.getByRole('button',{name:/Set 1, rally 7, score/}).click();
 await page.waitForURL('**r=1-7');await page.getByText('Loading tracks…',{exact:true}).waitFor();
 assert.equal(await page.locator('[data-playback="video"]').count(),0); release();await page.locator('[data-playback="video"]').waitFor();
 await page.unroute('**/replay/ai/s1r7.json');
 console.log('PASS no stale replay during pending request');
 let fail=true;
 await page.route('**/replay/ai/s1r8.json',route=>fail?route.fulfill({status:503,body:'temporary'}):route.continue());
 await page.getByRole('button',{name:/Set 1, rally 8, score/}).click();
 await page.getByRole('button',{name:'Retry tracking'}).waitFor();fail=false;
 await page.getByRole('button',{name:'Retry tracking'}).click();await page.locator('[data-playback="video"]').waitFor();
 console.log('PASS failed replay retries successfully');
 await page.goto(base+'/m/india_open_2022_final/ai/overview/');
 const dot=page.locator('svg [role="button"]').first();await dot.waitFor();await dot.focus();await page.keyboard.press('Enter');
 await page.waitForURL('**/film/?r=*');console.log('PASS keyboard chart evidence navigation');
 await page.goto(base+'/d/wtf_2024_md_sf/points/');
 const inferred=page.locator('svg [role="img"]').first();await inferred.waitFor();
 const pointsUrl=page.url();await inferred.focus();await page.keyboard.press('Enter');assert.equal(page.url(),pointsUrl);
 const scored=page.locator('svg [role="button"]').first();await scored.focus();await page.keyboard.press('Enter');
 await page.waitForURL('**/film/?r=*');console.log('PASS reconstructed points have no false replay links');

 await page.goto(base+'/d/wtf_2024_md_sf/film/?r=2');
 await page.getByRole('button',{name:'Next rally →',exact:true}).click(); await page.waitForURL('**r=3');
 await page.goBack();await page.waitForURL('**r=2');console.log('PASS doubles selection history');
 for(const width of [390,1440]){
  await page.setViewportSize({width,height:1000});
  for(const [name,url] of [['film','/m/all_england_2022_sf/ai/film/'],['lab','/m/all_england_2022_sf/ai/lab/'],['doubles-film','/d/wtf_2024_md_sf/film/'],['points','/m/india_open_2022_final/ai/points/']]){
   await page.goto(base+url);await page.waitForTimeout(800);
   const dims=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(dims.scroll<=dims.width+1,`${name} overflows at ${width}: ${JSON.stringify(dims)}`);
   await page.screenshot({path:require('node:path').join(require('node:os').tmpdir(), `courtside-after-${name}-${width}.png`),fullPage:true});
  }
 }
 assert.deepEqual(errors,[]);console.log('PASS 8 desktop/mobile layouts; no page errors');
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
