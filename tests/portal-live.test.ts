import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * THE PORTAL UPDATES BY ITSELF — and still shows nothing it did not get
 * from the server's sanitisers.
 *
 * The trigger component listens to ONE thing: the `/mdm/live/production`
 * marker every write path already announces (an id, a client id, a status
 * word, a timestamp — a hint, never data). On a hint for its client it
 * re-renders the page in place. It never subscribes to a table, and no
 * portal page reads the database from the browser: portal-data.ts and
 * portal-thread.ts stay the only path data reaches a client.
 */

const read = (p: string) => readFileSync(p, 'utf8')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []
  })
}

describe('PortalLive — the trigger', () => {
  const src = read('app/components/portal/PortalLive.tsx')

  it('subscribes to the production marker and nothing else', () => {
    expect(src).toMatch(/useLive\('production'/)
    expect(src).toMatch(/import \{ useLive \} from '@\/lib\/db-client'/)
    // no table reads, no raw refs, no rows
    expect(src).not.toMatch(/useTable|useRow|onValue|ref\(|snapshotToRows|firebase\/database/)
  })

  it('re-renders in place, debounced, only for its own client', () => {
    expect(src).toMatch(/router\.refresh\(\)/)
    expect(src).toMatch(/hinted !== clientId\) return/)
    expect(src).toMatch(/setTimeout/)
    expect(src).toMatch(/debounceMs = 300/)
  })

  it('is on every portal page, and the signed-in page reloads its own data', () => {
    expect(read('app/portal/[token]/page.tsx')).toMatch(/<PortalLive clientId=\{data\.client\.id\} \/>/)
    expect(read('app/portal/[token]/shoot/[id]/page.tsx')).toMatch(/<PortalLive clientId=\{portal\.client\.id\} \/>/)
    expect(read('app/client/page.tsx')).toMatch(/<PortalLive clientId=\{data\.client\.id\} onChange=\{load\} \/>/)
  })
})

describe('the sanitisers are the only readers', () => {
  const files = [...walk('app/portal'), 'app/client/page.tsx', ...walk('app/components/portal')]

  it('no portal page or component reads the database from the browser', () => {
    for (const f of files) {
      const s = read(f)
      if (f.endsWith('PortalLive.tsx')) continue
      expect(s, f).not.toMatch(/lib\/db-client|lib\/db'|from '@\/lib\/db'|firebase/)
    }
  })

  it('the pages get their data from portal-data / portal-thread', () => {
    expect(read('app/portal/[token]/page.tsx')).toMatch(/getPortalDataByToken/)
    expect(read('app/portal/[token]/shoot/[id]/page.tsx')).toMatch(/getPortalShootDetail/)
    expect(read('app/client/page.tsx')).toMatch(/fetch\('\/api\/portal'/)
  })
})
