import type { Metadata } from 'next'
import LegalShell, { A, LI, P, Section, UL } from '../components/legal/LegalShell'
import { DATA_DELETION_DRAFT, LEGAL_EMAIL, legalRobots } from '../lib/legal-pages'
import DeletionRequestForm from './DeletionRequestForm'

/**
 * How to ask MD Media to delete your data — the page Meta's App Review asks
 * for as the "Data Deletion Instructions URL". Requests made through Meta
 * arrive at POST /api/meta/data-deletion instead and are checked at
 * /data-deletion/status. Draft switch: app/lib/legal-pages.ts.
 */

export const metadata: Metadata = {
  title: 'Data Deletion — MD Media Marketing',
  description: 'How to ask MD Media to delete the personal information we hold about you, and how to check a request.',
  robots: legalRobots(DATA_DELETION_DRAFT),
  alternates: { canonical: 'https://www.mdmmarketing.com.au/data-deletion' },
}

const MAIL = `mailto:${LEGAL_EMAIL}?subject=${encodeURIComponent('Data deletion')}`

export default function DataDeletionPage() {
  return (
    <LegalShell
      eyebrow="legal / data deletion"
      title="Delete your data"
      draft={DATA_DELETION_DRAFT}
      vol="Data deletion"
      intro={<p style={{ margin: 0 }}>You can ask us to delete the personal information we hold about you at any time. It is free, and you do not need to give a reason.</p>}
    >
      <Section title="How to ask">
        <UL>
          <LI>Email <A href={MAIL}>{LEGAL_EMAIL}</A> with the subject line <strong>&ldquo;Data deletion&rdquo;</strong>. Tell us your name, the email address you used with us, and any social media usernames (for example your Instagram handle) so we can find everything; or</LI>
          <LI>fill in the form below, which writes that email for you; or</LI>
          <LI>if you used our app through Facebook or Instagram, remove it in your Facebook settings (Settings &amp; privacy &rarr; Settings &rarr; Apps and websites) and send a deletion request from there. You will be given a confirmation code to check below.</LI>
        </UL>
        <DeletionRequestForm to={LEGAL_EMAIL} />
      </Section>

      <Section title="What we delete">
        <P>We delete the personal information linked to you across our systems, including:</P>
        <UL>
          <LI>your enquiry, lead or prospect record and the notes about our conversations;</LI>
          <LI>newsletter, event and booking details (except payment records we must keep by law);</LI>
          <LI>records of comments or messages you sent to accounts we manage, and of any automated message we sent you;</LI>
          <LI>your entry in any follower or engagement list we still hold from before 30 September 2026 for a client&rsquo;s Instagram account;</LI>
          <LI>your sign-in to our client portal, if you have one.</LI>
        </UL>
        <P>
          Some things are not ours to delete: a comment you posted on Instagram stays on Instagram until you remove it there, and messages you sent a business stay in that business&rsquo;s inbox on the social network. We may also need to keep a record that your request was made and completed, and any information the law requires us to keep (for example tax records).
        </P>
      </Section>

      <Section title="How long it takes">
        <P>We aim to complete every request within 30 days. A person on our team handles every request; if we need to confirm who you are, we will ask.</P>
      </Section>

      <Section title="Check a request">
        <P>If you were given a confirmation code, enter it to see where your request is up to.</P>
        <form action="/data-deletion/status" method="get" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, margin: '4px 0 16px' }}>
          <label htmlFor="dd-code" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Confirmation code</label>
          <input id="dd-code" name="code" placeholder="Confirmation code" autoComplete="off" spellCheck={false}
            style={{ flex: '1 1 220px', minWidth: 0, background: 'rgba(249,244,235,0.06)', color: '#f9f4eb', border: '1px solid rgba(249,244,235,0.2)', borderRadius: 6, padding: '12px 14px', fontSize: 16, fontFamily: 'var(--font-sometype), monospace' }} />
          <button type="submit" style={{ background: 'transparent', color: '#f9f4eb', border: '1px solid rgba(249,244,235,0.5)', borderRadius: 100, padding: '12px 24px', fontSize: 14, cursor: 'pointer' }}>Check status</button>
        </form>
        <P>More about how we handle your information is in our <A href="/privacy">Privacy Policy</A>.</P>
      </Section>
    </LegalShell>
  )
}
