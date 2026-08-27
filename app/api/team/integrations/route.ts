import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { storageBackend } from '@/app/lib/storage'
import { driveStatus } from '@/app/lib/gdrive'
import { driveMemberNote } from '@/app/lib/gdrive-members'
import { zernioWebhookUrl } from '@/app/lib/zernio-webhook'
import { webhookDeliveryStats } from '@/app/lib/zernio-events'
import { previewStats, streamConfigured, streamWebhookUrl } from '@/app/lib/stream'
import { previewCountsLine } from '@/app/lib/stream-core'

/** "2 min ago" — the only form of this timestamp anybody reads off a card. */
function sinceWords(iso: string | null): string {
  if (!iso) return 'never'
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (!Number.isFinite(mins) || mins < 0) return 'just now'
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/**
 * What is actually connected.
 *
 * The Settings page used to list four integrations from a hardcoded array with
 * Instagram and Google Drive marked "connected" whether they were or not —
 * which is worse than showing nothing, because it answers the question wrongly
 * and confidently. Every field here is measured: an env var that exists, a row
 * that exists, a count from the database.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const viewer = await requireRole('account_manager')
    // ONE Drive connection serves the whole agency, so connecting and
    // disconnecting are super-admin acts. Hiding the button is presentation;
    // the routes enforce the same rule themselves.
    const canConnect = viewer.role === 'super_admin'

    // counted rather than assumed; a missing table means zero, not a crash
    const count = async (table: string, filter?: (q: never) => unknown) => {
      try {
        let q = supabase.from(table).select('id', { count: 'exact', head: true })
        if (filter) q = filter(q as never) as typeof q
        const { count: n } = await q
        return n ?? 0
      } catch { return 0 }
    }

    // Is the provider pushing outcomes to us, or are we still finding out from
    // the 10-minute poll? Either a registered webhook row or the env-var secret
    // counts — the handler accepts both, so the card must too.
    const instantUpdates = await (async () => {
      if (process.env.ZERNIO_WEBHOOK_SECRET) return true
      try {
        const { count: n } = await supabase
          .from('provider_webhooks').select('id', { count: 'exact', head: true })
          .eq('provider', 'zernio').eq('active', true)
        return (n ?? 0) > 0
      } catch { return false }
    })()

    // …and is anything actually ARRIVING? A registration proves the button was
    // pressed. It does not prove the URL is reachable, and Zernio disables a
    // webhook after ten consecutive delivery failures without telling us — at
    // which point a card reading "instant updates on" is confidently wrong.
    // A delivery timestamp is the only honest answer.
    const deliveries = await webhookDeliveryStats()

    const [socialAccounts, activeSocial, asanaProjects, asanaHooks] = await Promise.all([
      count('social_accounts'),
      (async () => {
        try {
          const { count: n } = await supabase
            .from('social_accounts').select('id', { count: 'exact', head: true }).eq('active', true)
          return n ?? 0
        } catch { return 0 }
      })(),
      count('asana_project_map'),
      count('asana_webhooks'),
    ])

    // ready / preparing / failed over the last seven days. Zero everywhere
    // when Stream is not configured, which is exactly what the card should say.
    const previews = await previewStats()

    const drive = await driveStatus()
    // who can open the tree, counted from the TEAM rather than by asking
    // Google: this card renders on every Settings visit, and a settings page
    // that waits on a Drive round trip to describe sharing is worse than one
    // that describes who should have access. "Re-share with team" is what
    // makes the two agree.
    const members = drive.connected
      ? await driveMemberNote(drive.sharing_domain, drive.account_email)
      : null

    const integrations = [
      {
        key: 'gdrive',
        name: 'Google Drive',
        detail: 'Every file, mirrored — raw, edits, finals and what goes out.',
        connected: drive.connected,
        configured: drive.configured,
        status: !drive.configured
          ? 'Not configured — the Internal Google app credentials are not set'
          : !drive.connected
            ? 'Configured, but no account connected yet'
            : [
                `Connected as ${drive.account_email ?? 'an account'} · files under "${drive.root_name}"`,
                // how a folder becomes reachable by the rest of the team is
                // the question an editor actually has when a link 404s. The
                // member line is the answer for everyone the domain grant
                // does not cover — the freelancer on a Gmail address.
                members?.note ?? drive.sharing_note,
              ].filter(Boolean).join(' · '),
        href: null,
        // full navigation, not fetch: /api/gdrive/connect answers with a
        // redirect to Google's own consent screen
        connect_href: drive.configured && !drive.connected && canConnect
          ? '/api/gdrive/connect' : null,
        disconnect_href: drive.connected && canConnect
          ? '/api/gdrive/disconnect' : null,
        action_href: drive.connected && canConnect ? '/api/gdrive/share' : null,
        action_label: 'Re-share with team',
      },
      {
        key: 'zernio',
        name: 'Social publishing',
        // This page is MD Media's own tooling, so the interesting fact is
        // whether the publishing service itself is wired up — not how many
        // client accounts exist, which belongs on the Social channels page and
        // is per client anyway.
        detail: 'The service behind posting, analytics and social inbox.',
        connected: Boolean(process.env.ZERNIO_API_KEY),
        configured: Boolean(process.env.ZERNIO_API_KEY),
        status: !process.env.ZERNIO_API_KEY
          ? 'No API key set'
          : [
              `Connected · ${activeSocial} client account${activeSocial === 1 ? '' : 's'} linked, managed per client`,
              instantUpdates
                ? `Instant updates: on${deliveries.ever
                    ? ` · last delivery ${sinceWords(deliveries.last_at)}`
                      + ` · ${deliveries.today} event${deliveries.today === 1 ? '' : 's'} today`
                    : ' · nothing delivered yet'}`
                : 'Instant updates: off — a published post is noticed within 10 minutes',
            ].join(' · '),
        href: '/dashboard/social',
        // one press registers our webhook with the provider; pressing it again
        // refreshes the same registration rather than adding a second one
        action_href: process.env.ZERNIO_API_KEY && canConnect
          ? '/api/team/integrations/zernio-webhook' : null,
        action_label: instantUpdates ? 'Refresh instant post updates' : 'Enable instant post updates',
        // the same URL to paste into Zernio's dashboard, for whoever would
        // rather register it there than press the button
        copy_value: zernioWebhookUrl(),
        copy_label: 'Copy webhook URL',
      },
      {
        key: 'asana',
        name: 'Asana',
        detail: 'Task activity behind the Team Activity page.',
        connected: Boolean(process.env.ASANA_PAT) && asanaProjects > 0,
        configured: Boolean(process.env.ASANA_PAT),
        status: !process.env.ASANA_PAT
          ? 'No token set'
          : asanaProjects > 0
            ? `${asanaProjects} project${asanaProjects === 1 ? '' : 's'} tracked, ${asanaHooks} with live updates`
            : 'Token set, nothing tracked yet',
        href: '/dashboard/activity',
      },
      {
        key: 'gmail',
        name: 'Inbox scanning',
        detail: 'Reads recent mail and turns genuine enquiries into leads.',
        connected: Boolean(process.env.GMAIL_REFRESH_TOKEN || process.env.GMAIL_CLIENT_ID),
        configured: Boolean(process.env.GMAIL_CLIENT_ID),
        status: process.env.GMAIL_USER
          ? `Watching ${process.env.GMAIL_USER}`
          : 'No mailbox configured',
        href: '/dashboard/leads',
      },
      {
        key: 'storage',
        name: 'Media storage',
        detail: 'Where uploaded images and video live.',
        connected: true,
        configured: true,
        status: storageBackend() === 'r2'
          ? 'Cloudflare R2'
          : 'Supabase Storage — files above ~45MB will be refused until R2 is configured',
        href: '/dashboard/website',
      },
      {
        key: 'stream',
        name: 'Video previews (Cloudflare Stream)',
        detail: 'Makes camera .mov files playable in the browser, without touching the original.',
        // "connected" means encodes are actually landing, not that a token
        // exists — a token with the wrong permissions configures fine and
        // fails every copy, and a card that said "connected" about that would
        // be the confidently-wrong answer this page was rewritten to stop.
        connected: streamConfigured() && previews.ready > 0,
        configured: streamConfigured(),
        status: !streamConfigured()
          ? 'Not configured — set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_STREAM_TOKEN. '
            + 'Until then a .mov that will not play says why, as it does today'
          : [
              previewCountsLine(previews),
              process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET
                ? 'Instant ready notices: on'
                : 'Instant ready notices: off — an encode is noticed within 30 minutes',
            ].join(' · '),
        href: null,
        // super admin only, and the route enforces it: this deletes encodes
        // at Cloudflare and pays to make them again
        action_href: canConnect && streamConfigured() && previews.failed > 0
          ? '/api/team/integrations/stream-retry' : null,
        action_label: 'Retry failed',
        copy_value: streamConfigured() ? streamWebhookUrl() : null,
        copy_label: 'Copy webhook URL',
      },
      {
        key: 'inngest',
        name: 'Scheduled jobs',
        detail: 'Runs the inbox scan, the Asana sync and the publish queue.',
        connected: Boolean(process.env.INNGEST_EVENT_KEY && process.env.INNGEST_SIGNING_KEY),
        configured: Boolean(process.env.INNGEST_SIGNING_KEY),
        status: process.env.INNGEST_SIGNING_KEY
          ? 'Connected — inbox scan every 5 minutes'
          : 'Not configured, so nothing runs on a schedule',
        href: null,
      },
      {
        key: 'anthropic',
        name: 'Claude',
        detail: 'Decides whether an email is a genuine enquiry.',
        connected: Boolean(process.env.ANTHROPIC_API_KEY),
        configured: Boolean(process.env.ANTHROPIC_API_KEY),
        status: process.env.ANTHROPIC_API_KEY ? 'API key set' : 'No API key set',
        href: null,
      },
    ]

    return NextResponse.json(integrations)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
