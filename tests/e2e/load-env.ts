import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Load .env.local before any app module imports — lib/firebase-config.ts and
// lib/db.ts read NEXT_PUBLIC_FIREBASE_DATABASE_URL lazily at request time
// (CLAUDE.md trap 7), so import ordering matters less than it used to, but
// this still has to run before anything that reads process.env at load time.
// belt AND braces: even if an upstream bug resolves a real person as a
// recipient, the mailer refuses to send to anything not ending in .invalid
process.env.EMAIL_TEST_ONLY = '1'

const file = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
for (const line of file.split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
  if (!m) continue
  const [, key, raw] = m
  if (process.env[key] !== undefined) continue
  process.env[key] = raw.replace(/^"(.*)"$/, '$1')
}
