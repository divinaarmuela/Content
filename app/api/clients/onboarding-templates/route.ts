import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { OnboardingTemplate } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { defaultOnboarding, normaliseOnboarding, templateId, templateName } from '../../../lib/onboarding-email-core'
import { ONBOARDING_ROLES } from '../[id]/onboarding/shared'

/**
 * WELCOME EMAIL TEMPLATES, SHARED ACROSS CLIENTS (the owner, 13 Nov 2026: "make sure we can save as a template and
 * in other clients when creating we can choose from the templates"). A template is a named set of the email's words.
 * Account managers and super admins read and save them. Saving under a name that exists replaces that template.
 */

async function gate() {
  const user = await requireRole('account_manager')
  if (!ONBOARDING_ROLES.includes(user.role)) return { denied: NextResponse.json({ error: 'Only account managers and super admins can use onboarding templates' }, { status: 403 }) }
  return { user }
}

export async function GET() {
  return withRequestCache(async () => {
  try {
    const g = await gate()
    if (g.denied) return g.denied
    const base = defaultOnboarding({ clientName: '' })
    const rows = await table<OnboardingTemplate>('onboarding_templates').list()
    const templates = rows
      .map(r => ({ id: r.id, name: r.name, draft: normaliseOnboarding(r.draft, base), updated_at: r.updated_at, updated_by_name: r.updated_by_name }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return NextResponse.json({ templates })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

export async function POST(req: Request) {
  return withRequestCache(async () => {
  try {
    const g = await gate()
    if (g.denied) return g.denied
    const body = await req.json().catch(() => ({}))
    const name = templateName(body?.name)
    if (!name) return NextResponse.json({ error: 'Give the template a name' }, { status: 422 })
    const draft = normaliseOnboarding(body?.draft, defaultOnboarding({ clientName: '' }))
    const id = templateId(name)
    const now = new Date().toISOString()
    const existing = await table<OnboardingTemplate>('onboarding_templates').get(id)
    await table<OnboardingTemplate>('onboarding_templates').upsert({
      id, name, draft, created_at: existing?.created_at ?? now, updated_at: now,
      updated_by: g.user.id, updated_by_name: g.user.name ?? g.user.email ?? null,
    })
    return NextResponse.json({ template: { id, name, draft, updated_at: now, updated_by_name: g.user.name ?? g.user.email ?? null }, replaced: !!existing })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
