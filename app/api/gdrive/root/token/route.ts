import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { accessToken } from '../../../../lib/gdrive'

/**
 * A short-lived Google token for the folder chooser, and nothing else.
 *
 * The Google Picker cannot show a person their Drive without an OAuth token,
 * and the token it is given decides which app the "you may use this folder"
 * grant lands on. It has to be THIS app's token, from the connected account,
 * or the picked folder stays invisible to the server that has to file into it.
 *
 * What is handed out is deliberately narrow:
 *   - super_admin only, the same bar as connecting and disconnecting;
 *   - an ACCESS token, which Google expires in about an hour, never the
 *     refresh token, which is the durable credential and never leaves here;
 *   - a token whose scope is `drive.file` — folders this app made or was
 *     handed — so it cannot read the account's other files even in principle.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requireRole('super_admin')
    const auth = await accessToken()
    if (!auth.ok) {
      return NextResponse.json(
        {
          error: auth.reason === 'not_configured'
            ? 'Google Drive is not set up yet'
            : 'Connect Google Drive first',
        },
        { status: 400 },
      )
    }
    // never stored anywhere on the way back: an OAuth token in a proxy
    // cache, or in the back/forward cache, is a token somebody else can
    // read minutes later
    return NextResponse.json({ token: auth.token }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
