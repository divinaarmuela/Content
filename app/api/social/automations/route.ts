import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { getPublisher } from '@/app/lib/publisher'
import { parseAutomationDraft, automationPayload } from '@/app/lib/automation-core'

/** Comment→DM automations: "comment LINK and the account DMs you". */
export async function GET() {
  try {
    await requireRole('scheduler')
    return NextResponse.json({ automations: await getPublisher().listAutomations() })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Create one. The browser sends the draft plus our account row id; the
 *  provider's profileId comes from the account's client — never the client. */
export async function POST(req: Request) {
  try {
    await requireRole('scheduler')
    const body = await req.json()

    const draft = parseAutomationDraft(body)
    if (!draft.ok) return NextResponse.json({ error: draft.error }, { status: 400 })

    const accountRowId = String(body.accountRowId ?? '')
    if (!accountRowId) return NextResponse.json({ error: 'Pick an account' }, { status: 400 })

    const { data: account } = await supabase
      .from('social_accounts')
      .select('provider_account_id, client_id, active')
      .eq('id', accountRowId)
      .maybeSingle()
    if (!account?.active) {
      return NextResponse.json({ error: 'That account is not connected' }, { status: 400 })
    }

    const { data: client } = await supabase
      .from('clients')
      .select('social_profile_id')
      .eq('id', account.client_id)
      .maybeSingle()
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
}
