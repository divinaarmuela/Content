import { NextResponse } from 'next/server'
import { authzErrorResponse } from '../../../lib/authz'
import { driveConfigured, driveStatus } from '../../../lib/gdrive'
import {
  FILES_BLOCK_WORDS, filesRoot, requireFilesAccess, type FilesBlock,
} from '../../../lib/drive-page'
import { PARTIAL_VIEW_NOTE } from '../../../lib/files-core'

/**
 * Where the Files page starts, what it cannot see, and — when it cannot start
 * at all — WHICH of the reasons it is.
 *
 * Three different states used to read "Google Drive is not connected yet", and
 * only one of them was true. Somebody whose refresh token had expired was told
 * to connect an account that was already connected, went to Settings, saw it
 * connected, and had nowhere to go from there. So the reply names the state:
 * not set up, not connected, connected-but-nobody-has-picked-HQ, or reachable.
 *
 * This route READS. It creates nothing and writes nothing — it used to be able
 * to make a folder in the tech account's Drive through a fallback, which is
 * not a thing a GET should ever have been able to do.
 *
 * `partial` is always true and says so out loud: the app holds Google's
 * `drive.file` scope, so it sees folders it created and folders a person handed
 * it through the chooser, and nothing else.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requireFilesAccess()

    const reply = (block: FilesBlock) => NextResponse.json({
      connected: block !== 'not_connected' && block !== 'not_configured',
      picked: false,
      root: null,
      block,
      message: FILES_BLOCK_WORDS[block],
      partial: true,
      note: PARTIAL_VIEW_NOTE,
    })

    if (!driveConfigured()) return reply('not_configured')
    const status = await driveStatus()
    if (!status.connected) return reply('not_connected')

    const root = await filesRoot()
    if (!root) return reply('not_picked')

    return NextResponse.json({
      connected: true,
      picked: true,
      root,
      block: null,
      message: null,
      partial: true,
      note: PARTIAL_VIEW_NOTE,
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
