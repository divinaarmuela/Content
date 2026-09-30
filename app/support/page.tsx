import type { Metadata } from 'next'
import LegalShell, { A, Fill, LI, P, Section, UL } from '../components/legal/LegalShell'
import { LEGAL_EMAIL, SUPPORT_DRAFT, legalRobots } from '../lib/legal-pages'

/** Support and contact for the app (Meta App Review groundwork, 30 Sep 2026). Draft switch: app/lib/legal-pages.ts. */

export const metadata: Metadata = {
  title: 'Support — MD Media Marketing',
  description: 'How to get help with the MD Media app, your connected accounts, or your data.',
  robots: legalRobots(SUPPORT_DRAFT),
  alternates: { canonical: 'https://www.mdmmarketing.com.au/support' },
}

const MAIL = `mailto:${LEGAL_EMAIL}`

export default function SupportPage() {
  return (
    <LegalShell
      eyebrow="support"
      title="Support"
      draft={SUPPORT_DRAFT}
      vol="Support"
      intro={<p style={{ margin: 0 }}>Need help with the MD Media app, a connected account, or your data? Email us and a person on our team will reply.</p>}
    >
      <Section title="Contact us">
        <UL>
          <LI>Email: <A href={MAIL}>{LEGAL_EMAIL}</A></LI>
          <LI>Phone: <Fill>[PHONE]</Fill></LI>
          <LI>Post: MD Media Marketing Pty Ltd, <Fill>[ADDRESS]</Fill></LI>
          <LI>We reply within <Fill>[e.g. 2 business days]</Fill>, Monday to Friday, Melbourne time.</LI>
        </UL>
      </Section>

      <Section title="Common requests">
        <UL>
          <LI><strong>Disconnect an Instagram or Facebook account</strong> — ask your account manager, or email us with the account&rsquo;s username. You can also remove our access from your Instagram or Facebook settings at any time.</LI>
          <LI><strong>Stop a comment-to-message automation</strong> — email us with the post, and we switch it off.</LI>
          <LI><strong>Delete your data</strong> — see <A href="/data-deletion">Delete your data</A>.</LI>
          <LI><strong>What we collect and why</strong> — see our <A href="/privacy">Privacy Policy</A>.</LI>
        </UL>
        <P>More about what the app does: <A href="/app-info">The MD Media app</A>.</P>
      </Section>
    </LegalShell>
  )
}
