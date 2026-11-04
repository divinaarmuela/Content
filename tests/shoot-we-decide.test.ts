import { describe, it, expect } from 'vitest'
import { stageMove, mayDecideShoot } from '../app/lib/shoot-sop-core'

const shoot = { id: 's1', client_id: 'c1', created_by: 'am1', owner_id: 'am1', status: 'brief', shoot_date: '2026-12-01', title: 'T' } as never
const base = { today: '2026-11-04', checklist: { itemCount: 0 }, clientIds: ['c1'] }

describe('we decide: share and confirm by hand (4 Nov 2026)', () => {
  it('without force, sharing an empty plan with nobody on it is refused', () => {
    expect(stageMove(shoot, 'shared', { ...base, role: 'account_manager' }, 'now', 'am1').ok).toBe(false)
  })
  it('an account manager can share it anyway', () => {
    const m = stageMove(shoot, 'shared', { ...base, role: 'account_manager', force: true }, 'now', 'am1')
    expect(m).toMatchObject({ ok: true, patch: { brief_shared_at: 'now', brief_shared_by: 'am1' } })
  })
  it('and confirm it straight from draft, which shares and books it too', () => {
    const m = stageMove(shoot, 'confirmed', { ...base, role: 'super_admin', force: true }, 'now', 'sa')
    expect(m.ok).toBe(true)
    if (m.ok) expect(m.patch).toMatchObject({ go_at: 'now', brief_shared_at: 'now' })
  })
  it('force means nothing for anyone else', () => {
    expect(mayDecideShoot('editor')).toBe(false)
    expect(stageMove(shoot, 'shared', { ...base, role: 'general', force: true }, 'now', 'am1').ok).toBe(false)
  })
})
