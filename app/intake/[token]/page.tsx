import type { Metadata, Viewport } from 'next'
import { notFound, redirect } from 'next/navigation'
import { onePortalFormRedirect } from '../../lib/one-portal-forms'
import { archivo, sometype } from '../../components/lama/fonts'
import { table, withRequestCache } from '@/lib/db'
import type { Client } from '@/lib/db-types'
import { getIntakeByToken, listIntakeFiles } from '../../lib/intake'
import IntakeForm from './IntakeForm'

export const metadata: Metadata = {
  title: 'Welcome to MD Media',
  robots: 'noindex, nofollow', // secret-link page, never indexed
}

/** Zoom stays ENABLED — disabling it breaks pinch-zoom for anyone who needs to
 *  enlarge text, and it is not what stops the auto-zoom anyway. The fix for
 *  that is 16px inputs, which is what blocks.tsx does. */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

// share links are checked live; a client's answers are never cached
export const dynamic = 'force-dynamic'

/** The intake form, behind an unguessable per-client token. No login: the
 *  token is the credential, which is why nothing sensitive is collected here
 *  and a submitted form stops accepting writes. */
export default async function IntakePage({ params }: { params: Promise<{ token: string }> }) {
 return withRequestCache(async () => {
  const { token } = await params
  // a client on the one portal: this old link opens the same form inside their one link (Shoot brief tab)
  const moved = await onePortalFormRedirect('intake', token)
  if (moved) redirect(moved)
  const form = await getIntakeByToken(token)
  if (!form) notFound()

  const client = await table<Client>('clients').get(form.client_id)

  return (
    <div className={`${archivo.variable} ${sometype.variable}`}>
      <IntakeForm
        token={token}
        clientName={client?.name ?? ''}
        title={form.title || 'Intake'}
        definition={form.definition}
        initialAnswers={form.answers}
        initialStatus={form.status}
        files={await listIntakeFiles(form.id)}
      />
    </div>
  )
 })
}
