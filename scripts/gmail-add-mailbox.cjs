#!/usr/bin/env node
/**
 * Add another Gmail mailbox to the lead scanner.
 *
 *   node scripts/gmail-add-mailbox.cjs
 *
 * Opens Google's consent screen, you sign in AS THE MAILBOX you want to add
 * (e.g. contact@mdmmarketing.com.au), and it prints the GMAIL_MAILBOXES value
 * to paste into .env.local (and later into Vercel's env settings).
 *
 * One-time prerequisite: in Google Cloud Console → Credentials → your OAuth
 * client, add this redirect URI:  http://localhost:5599/callback
 */
const fs = require('fs')
const path = require('path')
const http = require('http')
const { execSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const ENV = path.join(ROOT, '.env.local')

for (const line of fs.readFileSync(ENV, 'utf-8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const CLIENT_ID = process.env.GMAIL_CLIENT_ID
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET
const REDIRECT = 'http://localhost:5599/callback'
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET missing from .env.local')
  process.exit(1)
}

/** Existing mailboxes, so we append rather than replace. */
function existingMailboxes() {
  const out = []
  if (process.env.GMAIL_MAILBOXES) {
    try { out.push(...JSON.parse(process.env.GMAIL_MAILBOXES)) } catch {}
  }
  if (process.env.GMAIL_USER && process.env.GMAIL_REFRESH_TOKEN &&
      !out.some(m => m.email === process.env.GMAIL_USER)) {
    out.push({ email: process.env.GMAIL_USER, refreshToken: process.env.GMAIL_REFRESH_TOKEN })
  }
  return out
}

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent',            // force a refresh token every time
})

console.log('\n1. A browser window will open Google\'s consent screen.')
console.log('2. Sign in AS THE MAILBOX you want to add (use an incognito window if')
console.log('   you are already signed in as someone else).')
console.log('3. Approve read access. This window will then print your config.\n')
console.log(`If the browser does not open, visit:\n${authUrl}\n`)

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/callback')) { res.writeHead(404).end(); return }
  const code = new URL(req.url, 'http://localhost:5599').searchParams.get('code')
  if (!code) { res.writeHead(400).end('No code returned'); return }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT, grant_type: 'authorization_code',
      }),
    })
    const tok = await tokenRes.json()
    if (!tok.refresh_token) throw new Error(`No refresh token returned: ${JSON.stringify(tok)}`)

    const profRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    })
    const prof = await profRes.json()
    const email = String(prof.emailAddress || '').toLowerCase()

    const boxes = existingMailboxes().filter(m => m.email !== email)
    boxes.push({ email, refreshToken: tok.refresh_token })

    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`<h2 style="font-family:system-ui">Connected ${email}</h2>
      <p style="font-family:system-ui">Return to your terminal for the config line.</p>`)

    console.log(`\n✅ Connected: ${email} (${prof.messagesTotal} messages)\n`)
    console.log('Replace/add this single line in .env.local:\n')
    console.log(`GMAIL_MAILBOXES=${JSON.stringify(boxes)}\n`)
    console.log(`Mailboxes now scanned: ${boxes.map(b => b.email).join(', ')}\n`)
    server.close()
    process.exit(0)
  } catch (e) {
    res.writeHead(500).end(String(e))
    console.error('\n❌ Failed:', e.message)
    server.close()
    process.exit(1)
  }
})

server.listen(5599, () => {
  try {
    execSync(`start "" "${authUrl}"`, { shell: 'cmd.exe', stdio: 'ignore' })
  } catch { /* user can paste the URL manually */ }
})
