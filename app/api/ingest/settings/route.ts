import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import {
  getScanSettings, saveScanSettings, listMailboxEntries, setMailboxEnabled,
} from '../../../lib/scan-settings'

/**
 * Is automatic scanning actually running?
 *
 * The schedule lives in Inngest, not in this app, so the toggle alone proves
 * nothing — without a connected Inngest app the cron never fires and the
 * setting is an intention rather than a fact. Report both so the UI can say
 * which it is instead of implying the schedule is live.
 */
async function scheduleStatus() {
  const connected = Boolean(process.env.INNGEST_EVENT_KEY && process.env.INNGEST_SIGNING_KEY)
  const { data } = await supabase
    .from('scan_runs')
    .select('started_at')
    .eq('trigger', 'scheduled')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    connected,
    last_scheduled_run: data?.started_at ?? null,
    // hours 6-22 inclusive at :00/:15/:30/:45 — the final run of the day is 22:45
    window: '6:00am – 10:45pm Melbourne, every 15 minutes',
  }
}

/** Scanner configuration.
 *
 *  Reading is available to any signed-in team member so the leads page can
 *  show what the scanner is doing. Changing anything — which mailboxes are
 *  scanned, thresholds, block lists — is super_admin only, enforced here in
 *  the route rather than by hiding controls. */

export async function GET() {
  try {
    await requireRole('editor')
    const [settings, mailboxes, schedule] = await Promise.all([
      getScanSettings(), listMailboxEntries(), scheduleStatus(),
    ])
    return NextResponse.json({ settings, mailboxes, schedule })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function PUT(req: Request) {
  try {
    const admin = await requireRole('super_admin')
    const body = await req.json()

    // { mailbox: "a@b.com", enabled: false } toggles one address
    if (typeof body?.mailbox === 'string') {
      await setMailboxEnabled(body.mailbox, Boolean(body.enabled), admin.email)
      const mailboxes = await listMailboxEntries()
      return NextResponse.json({ mailboxes })
    }

    const settings = await saveScanSettings(body?.settings ?? body, admin.email)
    return NextResponse.json({ settings })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
