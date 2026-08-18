import { channel } from 'inngest/realtime'
import { z } from 'zod'

/**
 * Realtime channels.
 *
 * `leads` is a single global channel rather than one per user: every signed-in
 * team member watching the leads page wants the same stream, and a per-user
 * channel would mean fanning the same publish out N times for no gain.
 *
 * The payload is deliberately thin — enough to say "a lead just arrived, and
 * roughly who from". The page refetches through the authenticated /api/leads
 * on receipt rather than trusting the message to be complete, so there is one
 * source of truth for what a lead looks like and no second shaping path to
 * keep in step.
 *
 * Note the shape: v4 takes a single options object. The `.addTopic(topic(…))`
 * builder is the v3-era `@inngest/realtime` package and does not exist here.
 */
export const leadsChannel = channel({
  name: 'leads',
  topics: {
    created: {
      schema: z.object({
        id: z.string(),
        /** for the toast: "New lead — Pure Allure Cosmetics" */
        label: z.string(),
        /** 'web_form' | 'email_ingest' — how it reached us */
        source: z.string(),
        ts: z.number(),
      }),
    },
  },
})

/**
 * Intake form progress, so a client filling one in is visible live rather
 * than on refresh.
 *
 * Its own channel rather than a topic on `leads`: the audiences differ. Every
 * team member watches leads; only whoever has a client page open cares about
 * that client's form. Subscribers filter on client_id.
 *
 * Published on every autosaved field. That is a lot of small messages by
 * design — the payload is four numbers and two ids, and the alternative is a
 * progress counter that lies until someone reloads.
 */
/**
 * Brand-guidelines scanning. A 60-page design document is chunked and read a
 * chunk at a time, which takes minutes — so the panel watches progress here
 * rather than holding a request open, and fills itself in when it lands.
 * Subscribers filter on client_id.
 */
export const brandChannel = channel({
  name: 'brand',
  topics: {
    progress: {
      schema: z.object({
        client_id: z.string(),
        /** 'scanning' | 'done' | 'failed' */
        status: z.string(),
        done: z.number(),
        total: z.number(),
        message: z.string().optional(),
        ts: z.number(),
      }),
    },
  },
})

/**
 * Attribution tracker activity — a click on a tracked link or a new asset in
 * the Content Register. One global channel like `leads`: whoever has the
 * Tracker open wants the same stream. Payloads are hints; the page refetches
 * through the authenticated /api/tracker on receipt.
 */
export const trackerChannel = channel({
  name: 'tracker',
  topics: {
    activity: {
      schema: z.object({
        kind: z.enum(['click', 'asset']),
        asset_id: z.string(),
        client_id: z.string().nullable(),
        label: z.string(),
        ts: z.number(),
      }),
    },
  },
})

export const intakeChannel = channel({
  name: 'intake',
  topics: {
    progress: {
      schema: z.object({
        form_id: z.string(),
        client_id: z.string(),
        status: z.string(),
        answered: z.number(),
        total: z.number(),
        ts: z.number(),
      }),
    },
  },
})
