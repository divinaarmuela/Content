import type { Metadata } from 'next'
import LegalShell, { A, Fill, H3, LI, P, Section, UL } from '../components/legal/LegalShell'
import { APP_INFO_DRAFT, LEGAL_EMAIL, legalRobots } from '../lib/legal-pages'

/**
 * WHAT THE APP IS, for Meta's reviewers and anyone else who asks (Meta App
 * Review groundwork, 30 Sep 2026). Describes only features that exist in the
 * code today. Draft switch: app/lib/legal-pages.ts.
 */

export const metadata: Metadata = {
  title: 'The MD Media App — MD Media Marketing',
  description: 'What the MD Media app does, who uses it, and how it uses connected Instagram and Facebook accounts.',
  robots: legalRobots(APP_INFO_DRAFT),
  alternates: { canonical: 'https://www.mdmmarketing.com.au/app-info' },
}

export default function AppInfoPage() {
  return (
    <LegalShell
      eyebrow="the app"
      title="The MD Media app"
      draft={APP_INFO_DRAFT}
      vol="The app"
      intro={<p style={{ margin: 0 }}>MD Media is a social media and content agency in Melbourne, Australia. The MD Media app, at app.mdmmarketing.com.au, is the tool our team and our clients use to plan, approve, publish and report on the clients&rsquo; social media. It is not a consumer app: every user is either an MD Media team member or a business that has engaged us.</p>}
    >
      <Section title="Who uses it">
        <UL>
          <LI><strong>Our team</strong> — account managers, editors, designers and schedulers, signed in with their MD Media account.</LI>
          <LI><strong>Our clients</strong> — businesses that engage MD Media. They sign in to the client portal (or open a private link we send them) to approve content and see results.</LI>
        </UL>
      </Section>

      <Section title="What it does with a connected Instagram or Facebook account">
        <P>A client connects their own business Instagram account or Facebook Page, and can disconnect it at any time. With that connection the app:</P>
        <H3>1. Publishes the client&rsquo;s approved posts</H3>
        <P>Our team prepares a post (images or video and a caption), it is approved in the app — by the client, or by our team where the client has asked us to post without their sign-off — and the app publishes it to the client&rsquo;s account at the booked time.</P>
        <H3>2. Shows comments and direct messages so our team can reply</H3>
        <P>The app&rsquo;s Inbox lists comments on the client&rsquo;s posts and direct messages sent to the client&rsquo;s account, so our team can answer them on the client&rsquo;s behalf. A person writes each reply.</P>
        <H3>3. Runs comment-to-message automations the client asked for</H3>
        <P>For one chosen post, a team member can switch on an automation: when someone comments a chosen keyword on that post, they receive one direct message (usually a link the client offered in the post) and a public reply. Each person is messaged at most once per post, and nothing is ever sent to anyone who did not comment on that post first.</P>
        <H3>4. Reports on performance</H3>
        <P>The app reads the client&rsquo;s own posts&rsquo; results (views, reach, likes, comments, shares, saves) and shows them to the client and our team.</P>
      </Section>

      <Section title="What it does not do">
        <UL>
          <LI>It does not sell or share data with advertisers or data brokers.</LI>
          <LI>It does not message people who have not first contacted the account or commented on the chosen post.</LI>
          <LI>It does not post to any account its owner has not connected.</LI>
        </UL>
      </Section>

      <Section title="How accounts are connected">
        <P>A client&rsquo;s Instagram professional account connects directly to this app with Instagram Login: the client (or their account manager, with the client present) signs in on Instagram&rsquo;s own screen and chooses what to allow. Other networks the agency posts to &mdash; LinkedIn, TikTok and YouTube &mdash; connect through Zernio, a social media management service.</P>
      </Section>

      <Section title="Contact and policies">
        <UL>
          <LI>Support: <A href="/support">mdmmarketing.com.au/support</A> or <A href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</A></LI>
          <LI><A href="/privacy">Privacy Policy</A> · <A href="/terms">Terms of Use</A> · <A href="/data-deletion">Delete your data</A></LI>
        </UL>
      </Section>
    </LegalShell>
  )
}
