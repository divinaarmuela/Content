import { serve } from 'inngest/next'
import { inngest } from '../../inngest/client'
import { functions } from '../../inngest/functions'

export const maxDuration = 300

/** Inngest endpoint — Inngest calls this to discover and execute functions.
 *  Requests are verified against INNGEST_SIGNING_KEY in production, so this
 *  route is intentionally outside the Clerk-protected matcher. */
export const { GET, POST, PUT } = serve({ client: inngest, functions })
