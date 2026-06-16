const puppeteer = require('puppeteer-core')
const CHROME = 'C:/Users/User/.cache/puppeteer/chrome/win64-131.0.6778.69/chrome-win64/chrome.exe'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

;(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 740 })
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(2500)
  const H = 740
  const geom = await page.evaluate(() => {
    const sp = document.querySelector('.silk-spacer'); const r = sp.getBoundingClientRect()
    return { spacerTop: r.top + window.scrollY, spacerH: sp.offsetHeight }
  })
  const videoTop = geom.spacerTop + geom.spacerH
  console.log('videoTop=', videoTop)
  const probe = () => page.evaluate(() => {
    const c = document.querySelector('.silk-canvas')
    return { op: c ? +(+getComputedStyle(c).opacity).toFixed(2) : 0, y: Math.round(window.scrollY), side: window.__silkSide || '?' }
  })

  // ---- 1) trigger DOWN ----
  await page.evaluate((y)=>window.scrollTo(0,y), geom.spacerTop - H - 40)
  await sleep(300)
  for (let i=0;i<90;i++){ await page.mouse.wheel({deltaY:70}); await sleep(16); const p=await probe(); if (p.y>videoTop+10 && p.op===0){ break } }
  await sleep(300)
  let p = await probe(); console.log('landed DOWN at y=', p.y, '(videoTop=', videoTop, ')')

  // ---- 2) PING-PONG test: stop and watch for ~1.5s, sample opacity (should stay 0) ----
  let maxOp = 0, fires = 0, lastOp = 0
  for (let i=0;i<90;i++){ await sleep(16); const q=await probe(); if(q.op>maxOp)maxOp=q.op; if(q.op>0.5 && lastOp<=0.5) fires++; lastOp=q.op }
  console.log('PING-PONG idle 1.5s -> maxOpacity=', maxOp, 'fireEvents=', fires, '(want 0/0)')

  // ---- 3) IMMEDIATE REVERSAL: from where we are, scroll up right away, expect up transition to fire ----
  console.log('immediate reversal: scrolling up...')
  let upFired = false, upStartY = (await probe()).y
  for (let i=0;i<40;i++){ await page.mouse.wheel({deltaY:-70}); await sleep(16); const q=await probe(); if(q.op>0.5){ upFired = true; console.log('  up transition FIRED at y=', q.y, 'op=', q.op, 'after', i, 'wheel steps'); break } }
  if(!upFired) console.log('  up transition did NOT fire within 40 steps (BAD)')

  await browser.close(); console.log('DONE')
})().catch(e=>{console.error('ERR',e);process.exit(1)})
