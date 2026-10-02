// THE ONE PORTAL ROLLOUT (the owner, 2 Oct 2026: "can we rollout the big build with the portal and all").
//
// Run from the project folder, in PowerShell:
//   node scripts/rollout-one-portal.mjs           switch every real client with a portal link onto the one portal,
//                                                  and tick Martin K as Colourist
//   node scripts/rollout-one-portal.mjs undo      switch them all back to the old portal (Martin's tick stays)
//
// Writes only clients.portal_one (and team_users.colourist for Martin). Nothing is emailed to anyone. Test clients
// (100M, ZZ E2E, ZZ TEST) are already on and are not touched; prospects without a portal link are skipped.
import fs from 'node:fs'

const env = fs.readFileSync('.env.local', 'utf8')
const base = (env.match(/^NEXT_PUBLIC_FIREBASE_DATABASE_URL=(.*)$/m)?.[1] ?? '').replace(/["\r]/g, '').trim()
if (!base) throw new Error('NEXT_PUBLIC_FIREBASE_DATABASE_URL not found in .env.local')

const undo = process.argv[2] === 'undo'
const TEST = /^(459e2564|d59d3fb2|99ba2c6f)/
const MARTIN = '2296a9b6'

const clients = Object.values((await (await fetch(`${base}/mdm/tables/clients.json`)).json()) ?? {})
const targets = clients.filter(c => !TEST.test(String(c.id)) && c.share_token && ['active', 'paused'].includes(c.status)
  && (undo ? c.portal_one === true : c.portal_one !== true))

for (const c of targets) {
  await fetch(`${base}/mdm/tables/clients/${c.id}.json`, { method: 'PATCH', body: JSON.stringify({ portal_one: !undo, updated_at: new Date().toISOString() }) })
  const now = await (await fetch(`${base}/mdm/tables/clients/${c.id}/portal_one.json`)).json()
  console.log(`${now === !undo ? 'ok ' : 'XX '} ${c.name} → ${now ? 'one portal' : 'old portal'}`)
}
console.log(`${targets.length} ${targets.length === 1 ? 'client' : 'clients'} ${undo ? 'switched back' : 'switched on'}`)

if (!undo) {
  const team = Object.values((await (await fetch(`${base}/mdm/tables/team_users.json`)).json()) ?? {})
  const martin = team.find(u => String(u.id).startsWith(MARTIN))
  if (martin) {
    await fetch(`${base}/mdm/tables/team_users/${martin.id}.json`, { method: 'PATCH', body: JSON.stringify({ colourist: true, updated_at: new Date().toISOString() }) })
    const on = await (await fetch(`${base}/mdm/tables/team_users/${martin.id}/colourist.json`)).json()
    console.log(`${on === true ? 'ok ' : 'XX '} ${martin.name} ticked as Colourist`)
  }
}
