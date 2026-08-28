import type { Metadata, Viewport } from 'next'
import { notFound } from 'next/navigation'
import { archivo, sometype } from '../../components/lama/fonts'
import { supabase } from '@/lib/supabase'
import { getMonthlyByToken } from '../../lib/monthly'
import { monthLabel } from '../../lib/monthly-core'
import MonthlyForm from './MonthlyForm'

export const metadata: Metadata = {
  title: 'Your monthly check-in — MD Media',
  robots: 'noindex, nofollow', // secret-link page, never indexed
}

/** Zoom stays ENABLED — 16px inputs (in blocks.tsx) are what stop iOS auto-zoom,
 *  not disabling pinch. */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

// share links are checked live; a client's answers are never cached
export const dynamic = 'force-dynamic'

/** The monthly form, behind an unguessable per-client-month token. No login:
 *  the token is the credential, which is why a submitted form stops accepting
 *  writes. */
export default async function MonthlyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const form = await getMonthlyByToken(token)
  if (!form) notFound()

  const { data: client } = await supabase
    .from('clients').select('name').eq('id', form.client_id).maybeSingle()

  return (
    <div className={`${archivo.variable} ${sometype.variable}`}>
      <MonthlyForm
        token={token}
        clientName={client?.name ?? ''}
        title={form.title || `Monthly update — ${monthLabel(form.month, form.year)}`}
        period={monthLabel(form.month, form.year)}
        definition={form.definition}
        initialAnswers={form.answers}
        initialStatus={form.status}
      />
    </div>
  )
}
