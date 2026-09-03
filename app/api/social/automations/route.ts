import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { SocialAccount, Client } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { getPublisher } from '@/app/lib/publisher'
import { parseAutomationDraft, automationPayload } from '@/app/lib/automation-core'

/** Comment→DM automations: "comment LINK and the account DMs you". */
export async function GET() {
  return withRequestCache(async () => {
  try {
    await requireRole('scheduler')
    return NextResponse.json({ automations: await getPublisher().listAutomations() })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

/** Create one. The browser sends the draft plus our account row id; the
 *  provider's profileId comes from the account's client — never the client. */
export async function POST(req: Request) {
  return withRequestCache(async () => {
  try {
    await requireRole('scheduler')
    const body = await req.json()

    const draft = parseAutomationDraft(body)
    if (!draft.ok) return NextResponse.json({ error: draft.error }, { status: 400 })

    const accountRowId = String(body.accountRowId ?? '')
    if (!accountRowId) return NextResponse.json({ error: 'Pick an account' }, { status: 400 })

    const account = await table<SocialAccount>('social_accounts').get(accountRowId)
    if (!account?.active) {
      return NextResponse.json({ error: 'That account is not connected' }, { status: 400 })
    }

    const client = account.client_id ? await table<Client>('clients').get(account.client_id) : null
    if (!client?.social_profile_id) {
      return NextResponse.json({ error: "The account's client has no publishing profile" }, { status: 400 })
    }

    const created = await getPublisher().createAutomation(
      automationPayload(draft.value, {
        profileId: client.social_profile_id,
        accountId: account.provider_account_id,
      }),
    )
    return NextResponse.json({ created })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
