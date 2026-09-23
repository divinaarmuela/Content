import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { prospectPath } from '../app/lib/acquisition'

/** A PROSPECT IS A PAGE, NOT A DRAWER (the owner, 23 Sep 2026). */
describe('a prospect on its own page', () => {
  it('has an address, and every link and email goes there', () => {
    expect(prospectPath('c206a289')).toBe('/dashboard/leads/acquisition/c206a289')
    const acq = readFileSync('app/dashboard/leads/acquisition/Acquisition.tsx', 'utf8')
    expect(acq).toContain("const setOpen = (id: string | null) => { if (id) router.push(`/dashboard/leads/acquisition/${encodeURIComponent(id)}`) }")
    expect(acq).not.toContain('<Sheet open={current !== null}')
    expect(acq).toContain('<ProspectSheet asPage prospect={current}')
    expect(readFileSync('app/dashboard/leads/acquisition/[id]/page.tsx', 'utf8')).toContain('<Acquisition view="pipeline" prospectId={id} />')
  })
  it('the sheet draws a heading on the page, and keeps the drawer title nowhere else', () => {
    const s = readFileSync('app/dashboard/leads/acquisition/ProspectSheet.tsx', 'utf8')
    expect(s).toContain('{asPage ? <h2 className="text-section-title">{p.business}</h2> : <SheetTitle className="text-section-title">{p.business}</SheetTitle>}')
  })
})
