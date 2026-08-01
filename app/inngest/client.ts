import { Inngest } from 'inngest'

/** Inngest client for MD Media background jobs.
 *  Local dev: `npx inngest-cli@latest dev` (no keys needed).
 *  Production: set INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY. */
export const inngest = new Inngest({ id: 'md-media-agency-os' })
