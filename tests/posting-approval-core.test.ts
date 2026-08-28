import { describe, it, expect } from 'vitest'
import {
  approvalChip, approvalStep, awaitsClientPostApproval, mayApprovePost,
  maySendPostApproval, nextApprovalState, parseApprovalState,
  publishBlockReason, stateAfterPostEdit, SEND_LABEL, WAITING_LINE,
} from '../app/lib/posting-approval-core'

describe('parseApprovalState — the tolerant read', () => {
  it('accepts exactly the four states', () => {
    for (const s of ['draft', 'pending', 'approved', 'changes'] as const) {
      expect(parseApprovalState(s)).toBe(s)
    }
  })
  it('degrades everything else to null — a missing column behaves like today', () => {
    for (const v of [null, undefined, '', 'PENDING', 'yes', 0, {}, [], true]) {
      expect(parseApprovalState(v)).toBeNull()
    }
  })
})

describe('publishBlockReason — the queue gate', () => {
  it('never blocks an item the gate has not touched (null / absent / garbage)', () => {
    expect(publishBlockReason(null)).toBeNull()
    expect(publishBlockReason(undefined)).toBeNull()
    expect(publishBlockReason('something-new')).toBeNull()
  })
  it('never blocks an approved post', () => {
    expect(publishBlockReason('approved')).toBeNull()
  })
  it('blocks pending, changes and draft — each with its own sentence', () => {
    expect(publishBlockReason('pending')).toMatch(/final approval/i)
    expect(publishBlockReason('changes')).toMatch(/changes/i)
    expect(publishBlockReason('draft')).toMatch(/approval/i)
  })
})

describe('the state machine: draft → pending → approved / → changes → pending', () => {
  it('send: fresh, draft and changes all become pending', () => {
    for (const from of [null, undefined, 'draft', 'changes']) {
      const r = nextApprovalState(from, 'send')
      expect(r).toEqual({ ok: true, state: 'pending' })
    }
  })
  it('re-sending a pending post is idempotent, not an error', () => {
    expect(nextApprovalState('pending', 'send')).toEqual({ ok: true, state: 'pending' })
  })
  it('send is refused on an already-approved post', () => {
    const r = nextApprovalState('approved', 'send')
    expect(r.ok).toBe(false)
  })
  it('approve: only a pending post can be approved', () => {
    expect(nextApprovalState('pending', 'approve')).toEqual({ ok: true, state: 'approved' })
    for (const from of [null, 'draft', 'changes', 'approved']) {
      expect(nextApprovalState(from, 'approve').ok).toBe(false)
    }
  })
  it('request_changes: only from pending, and it lands on changes', () => {
    expect(nextApprovalState('pending', 'request_changes')).toEqual({ ok: true, state: 'changes' })
    for (const from of [null, 'draft', 'approved', 'changes']) {
      expect(nextApprovalState(from, 'request_changes').ok).toBe(false)
    }
  })
  it('the loop closes: changes → send → pending → approve → approved', () => {
    const sent = nextApprovalState('changes', 'send')
    expect(sent).toEqual({ ok: true, state: 'pending' })
    expect(nextApprovalState('pending', 'approve')).toEqual({ ok: true, state: 'approved' })
  })
})

describe('editing after approval — the silent-change rule', () => {
  it('an approved post falls back to pending when its content changes', () => {
    expect(stateAfterPostEdit('approved')).toBe('pending')
  })
  it('every other state is left alone (pending shows the latest anyway; changes is being edited on purpose)', () => {
    for (const s of [null, undefined, 'pending', 'changes', 'draft', 'weird']) {
      expect(stateAfterPostEdit(s)).toBeNull()
    }
  })
})

describe('the hat checks', () => {
  it('the scheduling hat, the owner (editor hat) and a super admin may send', () => {
    expect(maySendPostApproval(['scheduler'])).toBe(true)
    expect(maySendPostApproval(['editor'])).toBe(true)
    expect(maySendPostApproval(['super_admin'])).toBe(true)
    expect(maySendPostApproval(['account_manager', 'scheduler'])).toBe(true)
  })
  it('an account manager holding no scheduling — and a client — may NOT send', () => {
    expect(maySendPostApproval(['account_manager'])).toBe(false)
    expect(maySendPostApproval(['client'])).toBe(false)
    expect(maySendPostApproval([])).toBe(false)
  })
  it('the account manager, a super admin and the client may approve', () => {
    expect(mayApprovePost(['account_manager'])).toBe(true)
    expect(mayApprovePost(['super_admin'])).toBe(true)
    expect(mayApprovePost(['client'])).toBe(true)
  })
  it('the scheduler and the editor may NOT approve their own post', () => {
    expect(mayApprovePost(['scheduler'])).toBe(false)
    expect(mayApprovePost(['editor'])).toBe(false)
    expect(mayApprovePost(['editor', 'scheduler'])).toBe(false)
  })
})

describe('the chip', () => {
  it('says where the post stands, in plain words', () => {
    expect(approvalChip('pending')).toEqual({ label: 'Waiting on approval', tone: 'waiting' })
    expect(approvalChip('approved')).toEqual({ label: 'Approved to post', tone: 'approved' })
    expect(approvalChip('changes')).toEqual({ label: 'Changes requested', tone: 'changes' })
  })
  it('says nothing at all on rows the gate never touched', () => {
    expect(approvalChip(null)).toBeNull()
    expect(approvalChip(undefined)).toBeNull()
    expect(approvalChip('draft')).toBeNull()
  })
})

describe('the portal bucket — posts waiting on the client', () => {
  const base = { status: 'approved_for_scheduling', posting_approval_state: 'pending', posting_client_required: true }
  it('a pending post the client was explicitly asked about qualifies', () => {
    expect(awaitsClientPostApproval(base)).toBe(true)
    expect(awaitsClientPostApproval({ ...base, status: 'scheduled' })).toBe(true)
  })
  it('the client toggle off keeps it off their portal', () => {
    expect(awaitsClientPostApproval({ ...base, posting_client_required: false })).toBe(false)
    expect(awaitsClientPostApproval({ ...base, posting_client_required: undefined })).toBe(false)
  })
  it('approved, changed, and untouched posts never appear', () => {
    expect(awaitsClientPostApproval({ ...base, posting_approval_state: 'approved' })).toBe(false)
    expect(awaitsClientPostApproval({ ...base, posting_approval_state: 'changes' })).toBe(false)
    expect(awaitsClientPostApproval({ ...base, posting_approval_state: null })).toBe(false)
  })
  it('an item still in the funnel never appears, whatever the gate says', () => {
    expect(awaitsClientPostApproval({ ...base, status: 'client_review' })).toBe(false)
    expect(awaitsClientPostApproval({ ...base, status: 'published' })).toBe(false)
  })
  it('a database without the columns answers false for every row', () => {
    expect(awaitsClientPostApproval({ status: 'approved_for_scheduling' })).toBe(false)
  })
})

describe('approvalStep — what the posting card draws for one viewer', () => {
  it('nothing sent yet: everyone sees the send step', () => {
    expect(approvalStep(null, ['scheduler'])).toBe('send')
    expect(approvalStep('draft', ['account_manager'])).toBe('send')
  })
  it('pending: the approver decides, everyone else waits', () => {
    expect(approvalStep('pending', ['account_manager'])).toBe('decide')
    expect(approvalStep('pending', ['super_admin'])).toBe('decide')
    expect(approvalStep('pending', ['scheduler'])).toBe('waiting')
    expect(approvalStep('pending', ['editor'])).toBe('waiting')
  })
  it('changes: back with the sender to fix and re-send', () => {
    expect(approvalStep('changes', ['scheduler'])).toBe('resend')
  })
  it('approved: the queue is open', () => {
    expect(approvalStep('approved', ['scheduler'])).toBe('open')
  })
  it('the words the card leans on exist and say the thing', () => {
    expect(SEND_LABEL).toBe('Send the post for approval')
    expect(WAITING_LINE).toBe('Waiting on final approval')
  })
})
