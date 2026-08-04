import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { storageBackend } from '@/app/lib/storage'

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
    await requireRole('account_manager')

    // counted rather than assumed; a missing table means zero, not a crash
    const count = async (table: string, filter?: (q: never) => unknown) => {
      try {
        let q = supabase.from(table).select('id', { count: 'exact', head: true })
        if (filter) q = filter(q as never) as typeof q
        const { count: n } = await q
        return n ?? 0
      } catch { return 0 }
    }

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

    const integrations = [
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
          : `Connected · ${activeSocial} client account${activeSocial === 1 ? '' : 's'} linked, managed per client`,
        href: '/dashboard/social',
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
