import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getIntakeByToken, listIntakeFiles } from '../../lib/intake'
import IntakeForm from './IntakeForm'

export const metadata: Metadata = {
  title: 'Welcome to MD Media',
  robots: 'noindex, nofollow', // secret-link page — never indexed
}

// share links are checked live; a client's answers are never cached
export const dynamic = 'force-dynamic'

/** The intake form, behind an unguessable per-client token. No login: the
 *  token is the credential, which is why nothing sensitive is collected here
 *  and a submitted form stops accepting writes. */
export default async function IntakePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const form = await getIntakeByToken(token)
  if (!form) notFound()

  return (
    <IntakeForm
      token={token}
      definition={form.definition}
      initialAnswers={form.answers}
      initialStatus={form.status}
      files={await listIntakeFiles(form.id)}
    />
  )
}
