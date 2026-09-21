import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { rowsFor, shootDetailsText, shootManagerChoices } from '../app/lib/shoot-sop-core'

describe('what was typed when the shoot was made can be changed and copied (21 Sep 2026)', () => {
  it('copies the details as plain lines, leaving out what is empty', () => {
    expect(shootDetailsText({ title: 'Spring reels', client: 'Kode Finance', description: ' Three reels for the rate cut ', shoot_date: null, manager: 'Divina' }))
      .toBe('Shoot: Spring reels\nClient: Kode Finance\nAccount manager: Divina\nWhat this shoot is for: Three reels for the rate cut')
    expect(shootDetailsText({})).toBe('')
    // the copy is the plan as it stands: every filled part, lists as lines
    expect(shootDetailsText({ title: 'S', call_time: '10:30 am', talent: 'Aaron', deliverables: ['3 reels', '', null], shots: ['Wide of the office'] }))
      .toBe('Shoot: S\nCall time: 10:30 am\nWhat is coming out of it:\n- 3 reels\nShot list:\n- Wide of the office\nTalent: Aaron')
    // a box is as tall as what is in it, within reason
    expect(rowsFor('')).toBe(2)
    expect(rowsFor('x'.repeat(300))).toBe(5)
    expect(rowsFor('a\nb\nc')).toBe(3)
    expect(rowsFor('x'.repeat(5000))).toBe(14)
  })

  it('offers the managing roles as the account manager, and whoever holds it now', () => {
    const team = [
      { id: 'a', role: 'account_manager' }, { id: 'e', role: 'editor' }, { id: 'g', role: 'general' }, { id: 's', role: 'super_admin' },
    ]
    expect(shootManagerChoices(team, null).map(t => t.id)).toEqual(['a', 'g', 's'])
    expect(shootManagerChoices(team, 'e').map(t => t.id)).toEqual(['a', 'e', 'g', 's'])
  })

  it('the shoot page edits both, and the server holds the account manager to the rule it has on create', () => {
    const page = readFileSync('app/dashboard/production/shoots/[id]/page.tsx', 'utf8')
    expect(page).toContain("onBlur={e => { const v = e.target.value; if (v !== (batch.description ?? '')) void patch('description', v) }}")
    expect(page).toContain('Copy details')
    // the copy waits for the save that pressing it started, and reads the server's answer
    expect(page).toContain('await savingRef.current.catch(() => null)')
    expect(page).toContain('Use this as the Objective')
    expect(readFileSync('app/dashboard/production/shoots/[id]/ShootSop.tsx', 'utf8'))
      .toContain("onValueChange={v => void onPatch('owner_id', v === 'none' ? null : v)}")
    const route = readFileSync('app/api/production/batches/[id]/route.ts', 'utf8')
    expect(route).toContain("if (body.owner_id && (!named || named.active_status !== true || named.role === 'client')) {")
  })
})
