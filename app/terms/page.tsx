import type { Metadata } from 'next'
import LegalShell, { A, Fill, LI, P, Section, UL } from '../components/legal/LegalShell'
import { LEGAL_EMAIL, TERMS_DRAFT, legalRobots } from '../lib/legal-pages'

/** Terms of use for the website and the app. Draft switch: app/lib/legal-pages.ts. */

export const metadata: Metadata = {
  title: 'Terms of Use — MD Media Marketing',
  description: 'The terms for using the MD Media website, client portal and app.',
  robots: legalRobots(TERMS_DRAFT),
  alternates: { canonical: 'https://www.mdmmarketing.com.au/terms' },
}

const MAIL = `mailto:${LEGAL_EMAIL}`

export default function TermsPage() {
  return (
    <LegalShell
      eyebrow="legal / terms"
      title="Terms of Use"
      draft={TERMS_DRAFT}
      vol="Terms"
      intro={<p style={{ margin: 0 }}>These terms apply when you use our website, our client portal or our app. Our marketing services themselves are provided under the separate agreement we sign with each client; if that agreement and these terms disagree, the agreement wins.</p>}
    >
      <Section title="1. Who we are">
        <P>These terms are between you and MD Media Marketing Pty Ltd (ABN <Fill>[ABN]</Fill>) of <Fill>[ADDRESS]</Fill> (&ldquo;MD Media&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). Contact: <A href={MAIL}>{LEGAL_EMAIL}</A>.</P>
      </Section>

      <Section title="2. Using the website and app">
        <UL>
          <LI>You may use the website to learn about us and contact us. The client portal and app are for our clients and team; you must keep your sign-in and any private links we send you to yourself.</LI>
          <LI>Do not misuse them: no attempts to break in, overload, copy or scrape them, and nothing unlawful, harmful or infringing.</LI>
          <LI>We may suspend access that breaks these terms or puts the service or other users at risk.</LI>
        </UL>
      </Section>

      <Section title="3. Connected social media accounts">
        <UL>
          <LI>When you connect a social media account, you confirm you are allowed to, and you authorise us to publish, read comments and messages, and reply on that account as agreed with you.</LI>
          <LI>Connections are made through our provider, Zernio. You can disconnect an account at any time.</LI>
          <LI>Your use of each social network is also governed by that network&rsquo;s own terms (for example Meta&rsquo;s terms for Facebook and Instagram).</LI>
        </UL>
      </Section>

      <Section title="4. Your content and ours">
        <UL>
          <LI>You keep ownership of the content and materials you give us. You grant us the right to use them to provide our services to you.</LI>
          <LI>Ownership of the content we create for you is set out in your client agreement. <Fill>[CONFIRM IP TERMS]</Fill></LI>
          <LI>Everything else on the website (text, design, logos) belongs to MD Media and may not be reused without permission.</LI>
        </UL>
      </Section>

      <Section title="5. Privacy">
        <P>How we handle personal information is explained in our <A href="/privacy">Privacy Policy</A>. To ask us to delete your data, see our <A href="/data-deletion">data deletion page</A>.</P>
      </Section>

      <Section title="6. Liability">
        <UL>
          <LI>We work to keep the website and app available and accurate, but we do not promise they will always be uninterrupted or error-free, and social networks may change or refuse a post outside our control.</LI>
          <LI>Nothing in these terms excludes rights you have under the Australian Consumer Law that cannot be excluded. Otherwise, to the extent the law allows, our liability is limited as set out in your client agreement <Fill>[CONFIRM LIABILITY CAP]</Fill>, and we are not liable for indirect or consequential loss.</LI>
        </UL>
      </Section>

      <Section title="7. Changes and governing law">
        <UL>
          <LI>We may update these terms; the date at the top shows the latest version.</LI>
          <LI>These terms are governed by the laws of Victoria, Australia <Fill>[CONFIRM STATE]</Fill>, and the courts there have jurisdiction.</LI>
        </UL>
      </Section>

      <Section title="8. Contact">
        <P>Questions about these terms: <A href={MAIL}>{LEGAL_EMAIL}</A>.</P>
      </Section>
    </LegalShell>
  )
}
