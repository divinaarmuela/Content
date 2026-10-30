import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

// 30 Oct 2026, the owner: "check asana. there new tasks that hasnt been added … no misses". The mirror read only the
// first 100 tasks of a project: 543 tasks in eight client projects never reached the activity page.

describe('every page of an Asana list is read', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it('a project of 250 tasks comes back whole, following next_page', async () => {
    vi.stubEnv('ASANA_PAT', 'test')
    const pages = [
      { data: Array.from({ length: 100 }, (_, i) => ({ gid: `a${i}` })), next_page: { offset: 'p2' } },
      { data: Array.from({ length: 100 }, (_, i) => ({ gid: `b${i}` })), next_page: { offset: 'p3' } },
      { data: Array.from({ length: 50 }, (_, i) => ({ gid: `c${i}` })), next_page: null },
    ]
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(url)
      const page = url.includes('offset=p3') ? pages[2] : url.includes('offset=p2') ? pages[1] : pages[0]
      return new Response(JSON.stringify(page), { status: 200 })
    }))
    const { tasksForProject } = await import('../app/lib/asana')
    const tasks = await tasksForProject('123')
    expect(tasks).toHaveLength(250)
    expect(seen).toHaveLength(3)
    expect(seen[2]).toContain('offset=p3')
  })

  it('the mirror writes only a new task or one Asana changed since', () => {
    const src = readFileSync('app/lib/asana-sync.ts', 'utf8')
    expect(src).toContain("if (had && String(had.modified_at ?? '').slice(0, 19) === String(t.modified_at ?? '').slice(0, 19)) continue")
  })
})
