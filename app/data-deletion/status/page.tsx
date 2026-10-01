import type { Metadata } from 'next'
import { table } from '@/lib/db'
import type { DataDeletionRequest } from '@/lib/db-types'
import LegalShell, { A, P, Section } from '../../components/legal/LegalShell'
import { DATA_DELETION_DRAFT, LEGAL_EMAIL } from '../../lib/legal-pages'
import { isConfirmationCode, statusWords } from '../../lib/meta-signed-request-core'

/**
 * The status of one data deletion request, by the confirmation code Meta
 * showed the person (POST /api/meta/data-deletion made it). Public: the code
 * is the only key, it is 16 hex characters of a hash, and the page shows the
 * status and dates only — never the Meta user id or the note.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Data Deletion Status — MD Media Marketing',
  robots: 'noindex, nofollow',
}

const fmt = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Melbourne' })
}

export default async function DataDeletionStatusPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const sp = await searchParams
  const raw = Array.isArray(sp.code) ? sp.code[0] : sp.code
  const code = (raw ?? '').trim().toLowerCase()

  let row: DataDeletionRequest | null = null
  let failed = false
  if (isConfirmationCode(code)) {
    try { row = await table<DataDeletionRequest>('data_deletion_requests').get(code, { fresh: true }) }
    catch { failed = true }
  }

  const words = row ? statusWords(row.status) : null

  return (
    <LegalShell eyebrow="legal / data deletion" title="Request status" draft={DATA_DELETION_DRAFT} vol="Data deletion">
      <Section title={code ? `Confirmation code ${code}` : 'No confirmation code'}>
        {!code && <P>Add the confirmation code you were given to the address, or enter it on the <A href="/data-deletion">data deletion page</A>.</P>}
        {code && !isConfirmationCode(code) && <P>That does not look like one of our confirmation codes. Please check it and try again.</P>}
        {failed && <P>We could not look up your request just now. Please try again in a few minutes.</P>}
        {isConfirmationCode(code) && !failed && !row && (
          <P>We could not find a request with this code. If you made the request very recently, try again shortly; otherwise email <A href={`mailto:${LEGAL_EMAIL}?subject=${encodeURIComponent('Data deletion')}`}>{LEGAL_EMAIL}</A> with the code.</P>
        )}
        {row && words && (
          <>
            <p style={{ fontSize: 'clamp(1.4rem, 3vw, 2rem)', fontWeight: 500, letterSpacing: '-0.02em', color: '#f9f4eb', margin: '0 0 10px' }}>{words.label}</p>
            <P>{words.detail}</P>
            <P>Received {fmt(row.received_at)}{row.status !== 'received' && row.updated_at ? ` · last updated ${fmt(row.updated_at)}` : ''}.</P>
            <P>Questions: <A href={`mailto:${LEGAL_EMAIL}?subject=${encodeURIComponent('Data deletion')}`}>{LEGAL_EMAIL}</A>, quoting your code.</P>
          </>
        )}
      </Section>
    </LegalShell>
  )
}
