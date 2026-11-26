import { NextResponse } from 'next/server'
import { searchCreators } from '../../../lib/creator-campaigns'
import { asTeam, isManager } from '../respond'

/** GET ?q= — the agency's own list of creators, by name or handle, for managers adding one to a campaign. */
export const dynamic = 'force-dynamic'

export function GET(req: Request) {
  return asTeam(async v => {
    if (!isManager(v)) return NextResponse.json({ error: 'The creator list is for managers' }, { status: 403 })
    return NextResponse.json({ creators: await searchCreators(new URL(req.url).searchParams.get('q') ?? '') })
  })
}
