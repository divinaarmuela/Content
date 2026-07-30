const puppeteer = require('puppeteer-core')
const log = []; const L = (...a) => log.push(a.join(' '))
;(async () => {
  const browser = await puppeteer.launch({ headless: 'new', executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] })
  const page = await browser.newPage()
  page.on('pageerror', e => L('[PAGEERROR]', e.message))
  for (const p of ['/sign-in', '/sign-up']) {
    await page.goto('http://localhost:3000' + p, { waitUntil: 'networkidle2', timeout: 30000 })
    await new Promise(r => setTimeout(r, 5000))
    const d = await page.evaluate(() => ({
      clerkLoaded: !!(window.Clerk && window.Clerk.loaded),
      hasGoogle: !!([...document.querySelectorAll('button')].find(b => /google/i.test(b.textContent||''))),
      hasEmailInput: !!document.querySelector('input[name="identifier"], input[type="email"], input[name="emailAddress"]'),
      heroText: (document.querySelector('.auth-hero')?.innerText || '').slice(0,40).replace(/\n/g,' '),
      bodyHas: /sign in|create|continue/i.test(document.body.innerText) ? 'form-text-present' : 'NO-FORM-TEXT',
    }))
    L(`[${p}]`, JSON.stringify(d))
  }
  console.log(log.join('\n'))
  await browser.close()
})().catch(e => { console.log(log.join('\n')); console.error('FATAL', e.message); process.exit(1) })
