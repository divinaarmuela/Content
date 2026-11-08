import { describe, expect, it } from 'vitest'
import { REVIEWER_CLIENT_ID as T, isReviewer, reviewerVerdict } from '../app/lib/reviewer-lock-core'

describe('the Meta reviewer login sees only the test client (9 Nov 2026)', () => {
  it('knows the reviewer and nobody else', () => {
    expect(isReviewer('user_3KFf2RcRERoLqtpWTvwkbwBIlj9')).toBe(true)
    expect(isReviewer('user_3LqUErloJO1148GwLyWXe8lhOzE')).toBe(true)
    expect(isReviewer('user_someoneElse')).toBe(false)
    expect(isReviewer(null)).toBe(false)
  })
  it('opens the test client pages', () => {
    expect(reviewerVerdict(`/dashboard/clients/${T}/social`)).toBe('allow')
    expect(reviewerVerdict(`/dashboard/clients/${T}`)).toBe('allow')
  })
  it('sends every other dashboard page to the test client', () => {
    for (const p of ['/dashboard', '/dashboard/', '/dashboard/leads', '/dashboard/clients', '/dashboard/clients/other-id/social', '/dashboard/reports', '/dashboard/social/content-tracker'])
      expect(reviewerVerdict(p)).toBe('home')
  })
  it('refuses the agency-wide APIs', () => {
    for (const p of ['/api/leads', '/api/website/clients', '/api/social/analytics', '/api/social/comments', '/api/shoots', '/api/team/notifications', '/api/metaX'])
      expect(reviewerVerdict(p)).toBe('refuse')
  })
  it('allows the Meta card, who-am-I, and anything naming the test client', () => {
    expect(reviewerVerdict('/api/meta/md-app')).toBe('allow')
    expect(reviewerVerdict('/api/meta/md-app/test')).toBe('allow')
    expect(reviewerVerdict('/api/team/me')).toBe('allow')
    expect(reviewerVerdict(`/api/website/clients/${T}`)).toBe('allow')
    expect(reviewerVerdict('/api/social/accounts', `?clientId=${T}`)).toBe('allow')
  })
  it('leaves the public site alone', () => {
    expect(reviewerVerdict('/privacy')).toBe('allow')
    expect(reviewerVerdict('/')).toBe('allow')
  })
})
