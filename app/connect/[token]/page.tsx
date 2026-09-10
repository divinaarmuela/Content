import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Toaster } from 'sonner'
import { table } from '@/lib/db'
import type { Client, SocialAccount } from '@/lib/db-types'
import { isShareToken, parseNetworks } from '../../lib/connect-link-core'
import { needsReconnect, readStoredHealth } from '../../lib/account-health-core'

const healthFacts = (raw: unknown) => {
  const h = readStoredHealth(raw)
  return { reconnect: needsReconnect(h), soon: h?.level === 'watch', reason: h?.reason ?? null }
}
import { archivo, sometype } from '../../components/lama/fonts'
import PortalShell from '../../components/portal/PortalShell'
import ConnectNetworks from './ConnectNetworks'

/**
 * THE CLIENT'S CONNECT PAGE — /connect/<token>?networks=…
 *
 * Opened from the link their account manager copied off Social channels.
 * No account of ours, no sign-in of ours: the token in the address is the
 * client's portal token, and the page lists the networks the manager ticked
 * with a Connect button on each. Pressing one runs THAT network's own
 * sign-in (Facebook's, TikTok's…) and comes back here; the accounts land
 * under this client and appear on the team's Schedule bar.
 *
 * Deliberately outside the middleware matcher, like /portal: served on any
 * host, with no Clerk session. `dynamic` because the accounts change the
 * moment the client says yes.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Connect your social accounts | MD Media',
  robots: { index: false, follow: false },
}

export default async function ConnectPage({ params, searchParams }: {
  params: Promise<{ token: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { token } = await params
  const q = await searchParams
  if (!isShareToken(token)) notFound()
  const client = (await table<Client>('clients').list({ where: r => r.share_token === token, limit: 1 }))[0]
  if (!client) notFound()

  const networksParam = Array.isArray(q.networks) ? q.networks[0] : q.networks
  const networks = parseNetworks(networksParam ?? null)
  const accounts = (await table<SocialAccount>('social_accounts').list({ by: { client_id: client.id } }))
    .filter(a => a.active !== false)
    .map(a => ({
      platform: String(a.platform), username: a.username ?? null, name: a.name ?? null,
      ...healthFacts((a as { health?: unknown }).health),
    }))
  const justConnected = Array.isArray(q.connected) ? q.connected[0] : q.connected
  // the network sent them back with an error instead of an account
  const returnError = Array.isArray(q.error) ? q.error[0] : q.error

  return (
    <PortalShell className={`dbx ${archivo.variable} ${sometype.variable}`}>
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-5 py-10 sm:px-8 sm:py-14">
        <header className="mb-8 flex flex-col gap-2">
          <p className="text-[11px] uppercase tracking-[0.2em] opacity-60" style={{ fontFamily: 'var(--font-sometype), monospace' }}>
            MD Media · {client.name}
          </p>
          <h1 className="text-[28px] font-semibold leading-tight sm:text-[34px]">Connect your social accounts</h1>
          <p className="max-w-prose text-[15px] leading-[1.5] opacity-80">
            Press <strong>Connect</strong> next to each network, sign in to it as you normally would, and
            allow MD Media to post on your behalf. You come straight back here. Nothing is posted
            without your team’s process. This only lets the posts you approve go out.
          </p>
        </header>

        <ConnectNetworks
          token={token}
          networks={networks}
          networksParam={networksParam ?? ''}
          initial={accounts}
          justConnected={justConnected ?? null}
          returnError={returnError ?? null}
        />

        <footer className="mt-auto pt-12">
          <p className="text-[12px] uppercase tracking-[0.14em] opacity-50" style={{ fontFamily: 'var(--font-sometype), monospace' }}>
            MD Media · get seen · get known · get booked
          </p>
        </footer>
        <Toaster position="top-center" />
      </div>
    </PortalShell>
  )
}
