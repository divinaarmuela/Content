import type { Metadata } from 'next'
import LegalShell, { A, Fill, H3, LI, P, Section, UL } from '../components/legal/LegalShell'
import { LEGAL_EMAIL, PRIVACY_DRAFT, legalRobots } from '../lib/legal-pages'

/**
 * THE PRIVACY POLICY. Written from the code on 30 Sep 2026 — every data
 * category below names something the app really stores or sends somewhere.
 * When a feature starts collecting something new, it belongs here too.
 * Draft switch and placeholders: app/lib/legal-pages.ts.
 */

export const metadata: Metadata = {
  title: 'Privacy Policy — MD Media Marketing',
  description: 'What personal information MD Media collects, why, who we share it with, and how to ask us to delete it.',
  robots: legalRobots(PRIVACY_DRAFT),
  alternates: { canonical: 'https://www.mdmmarketing.com.au/privacy' },
}

const MAIL = `mailto:${LEGAL_EMAIL}`

export default function PrivacyPage() {
  return (
    <LegalShell
      eyebrow="legal / privacy"
      title="Privacy Policy"
      draft={PRIVACY_DRAFT}
      vol="Privacy"
      intro={<p style={{ margin: 0 }}>This policy explains what personal information MD Media collects, why we collect it, who we share it with, how long we keep it, and how you can see, correct or delete it. We have tried to write it in plain English. If anything is unclear, email <A href={MAIL}>{LEGAL_EMAIL}</A>.</p>}
    >
      <Section id="who" title="1. Who we are">
        <P>
          MD Media Marketing Pty Ltd (ABN <Fill>[ABN]</Fill>), trading as MD Media (&ldquo;MD Media&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;), is a social media and content marketing agency based in Melbourne, Australia. Our address is <Fill>[ADDRESS]</Fill>.
        </P>
        <P>
          This policy covers our website <A href="https://www.mdmmarketing.com.au">mdmmarketing.com.au</A>, our client and team app at app.mdmmarketing.com.au, and the social media work we do for our clients. We handle personal information in line with the <em>Privacy Act 1988</em> (Cth) and the Australian Privacy Principles (APPs).
        </P>
        <P>Contact for anything in this policy: <A href={MAIL}>{LEGAL_EMAIL}</A>.</P>
      </Section>

      <Section id="what" title="2. What we collect, and why">
        <P>What we hold depends on how you deal with us. Each group below says what we collect, where it comes from, and what we use it for.</P>

        <H3>Visitors to our website</H3>
        <UL>
          <LI>We use Microsoft Clarity on the public marketing pages to understand how visitors use the site (pages viewed, clicks, scrolling, device and browser type). Clarity uses cookies. It is switched off on the signed-in app, the client portal and our intake forms.</LI>
          <LI>Our hosting provider keeps standard server logs (such as IP address and the page requested) for security and troubleshooting.</LI>
        </UL>

        <H3>People who contact us or book with us</H3>
        <UL>
          <LI><strong>Contact and enquiry forms:</strong> your name, email, phone, business name, the service you are interested in, budget, timeline and your message. We use this to reply to you and to manage the enquiry as a sales lead.</LI>
          <LI><strong>Newsletter and event sign-ups:</strong> your email address (and, for event invitations, your name and what you tell us about yourself), to send you what you asked for.</LI>
          <LI><strong>Bookings:</strong> your name, email, phone, notes, the time you booked and payment status. Card payments are handled by Stripe; we never see or store your full card number.</LI>
          <LI><strong>Emails to our business inboxes:</strong> we automatically scan new emails that arrive in our own business Gmail inboxes to find genuine business enquiries. The content of an email is sent to Anthropic&rsquo;s Claude AI model, which decides whether it is an enquiry and pulls out the sender&rsquo;s name, business, phone and the service they asked about. If it is an enquiry, we record it as a lead. We keep a log of each scanned email (sender, subject, date and the result) so the same email is never processed twice.</LI>
        </UL>

        <H3>Businesses we are talking to about working together (prospects)</H3>
        <UL>
          <LI>We keep a record of prospective clients: business name, contact name and role, email, phone, website, public social media handles, notes, and the history of our conversations (for example when we reached out, when you replied, and when a call was booked).</LI>
          <LI>To keep that record up to date, an AI assistant (Anthropic&rsquo;s Claude) reads the emails exchanged between you and our business inboxes and the Instagram direct messages exchanged between you and MD Media&rsquo;s own Instagram accounts, and notes events such as a reply or a booked call. A person on our team can review and correct what it records.</LI>
          <LI>We may look up your business&rsquo;s <em>public</em> Instagram profile (such as bio, follower count and recent public posts) through ScrapeCreators, a third-party data service, to prepare for a conversation with you.</LI>
          <LI>We never send an automated message to a prospect. Every message to a prospect is written or approved by a person.</LI>
        </UL>

        <H3>Our clients and their teams</H3>
        <UL>
          <LI><strong>Account and contact details:</strong> names, roles, email addresses and phone numbers of the people we work with, and your sign-in to our client portal (managed by Clerk).</LI>
          <LI><strong>Brand and project information:</strong> your answers to our intake forms, brand guidelines, content plans, scripts, feedback, approvals and comments you leave on content.</LI>
          <LI><strong>Files:</strong> photos, videos and documents you give us or that we produce for you. These are stored with Cloudflare (R2 storage and Stream video), and a copy of a large video may be processed by our video encoder (hosted on Fly.io) to fit a social network&rsquo;s limits. We also read files from our own Google Drive.</LI>
          <LI><strong>Logins you choose to share with us</strong> for your platforms are stored encrypted, and only the team members who need them can see them.</LI>
          <LI><strong>Shoots:</strong> shoots we book with you are added to our Google Calendar.</LI>
          <LI><strong>Other tools you connect:</strong> if you connect Linktree, we store the connection so we can update your links. We may track project tasks in Asana.</LI>
          <LI>We use this to deliver the services you engaged us for, to report on results, and to bill you.</LI>
        </UL>

        <H3>Our clients&rsquo; connected social media accounts</H3>
        <P>When a client connects a social media account (for example Instagram, Facebook, LinkedIn or TikTok) so we can post and manage it for them, the connection is made through <strong>Zernio</strong>, a social media management service that acts as our processor. Zernio holds the access permissions; we store the account&rsquo;s name, username, profile picture, platform, connection status and the account ID Zernio gives us.</P>
        <UL>
          <LI><strong>Posts:</strong> captions, images, videos, scheduled times, approval history and the published post&rsquo;s link. We use this to schedule and publish the client&rsquo;s content.</LI>
          <LI><strong>Post performance:</strong> figures such as views, reach, likes, comments, shares and saves, to report results to the client.</LI>
        </UL>

        <H3>People who comment on, message or follow our clients&rsquo; accounts</H3>
        <P>If you interact with a business we manage, we may process some information about you on that business&rsquo;s behalf:</P>
        <UL>
          <LI><strong>Comments and direct messages.</strong> Our team reads and answers comments and direct messages sent to our clients&rsquo; accounts through Zernio. These are shown live and are not copied into our database in bulk. We keep a short note that a person was in touch: their username, display name, whether it was a comment or a message, and when. We do not keep the words of the message in that note.</LI>
          <LI><strong>Comment-to-message automations.</strong> A client may switch on an automation for one specific post: if you comment a chosen keyword on that post, you receive a direct message (usually with a link) and a public reply to your comment. We keep a record of each one sent: your username and display name, your comment, the message we sent, and whether it was delivered. This record makes sure you are only ever messaged once per post. Nothing is sent unless a person switched the automation on for that post.</LI>
          <LI><strong>Followers and engagement on Instagram.</strong> For clients who have this feature switched on, we keep a list of the people who follow the client&rsquo;s Instagram account and who liked or commented on the client&rsquo;s posts: username, full name, profile picture link, whether the account is private or verified, and the dates we first and last saw them following. This lets the client see who followed and who engaged with a post. <strong>This information does not come from Meta&rsquo;s API.</strong> It is obtained from HikerAPI, a third-party service that reads publicly available Instagram profile information.</LI>
          <LI><strong>Public post previews.</strong> To show a preview of a public Instagram post or video, we may fetch it through Apify (a third-party service) or Meta&rsquo;s oEmbed service.</LI>
        </UL>

        <H3>Our team</H3>
        <UL>
          <LI>Name, email, role, working hours and sign-in (managed by Clerk), and a record of work done in the app, so we can run our business and keep the app secure.</LI>
        </UL>

        <H3>Emails we send</H3>
        <UL>
          <LI>The app sends service emails (for example that content is ready to approve, or a booking is confirmed) through SMTP2GO. We keep a log of each email sent: recipient, subject, content and delivery status, so the same email is not sent twice.</LI>
        </UL>
      </Section>

      <Section id="basis" title="3. Why we are allowed to use it">
        <P>We collect personal information only where it is reasonably necessary for our business and the services described above, and we use it for the purpose we collected it for, or a related purpose you would reasonably expect. In practice that means:</P>
        <UL>
          <LI><strong>You gave it to us</strong> (a form, an email, a booking) and asked us to act on it;</LI>
          <LI><strong>To deliver a contract</strong> with our clients, including managing their social media accounts with their permission;</LI>
          <LI><strong>Our legitimate business interests</strong>, such as following up a business enquiry or keeping the app secure; and</LI>
          <LI><strong>Your consent</strong>, where the law requires it (for example our newsletter, which you can ask us to stop sending at any time).</LI>
        </UL>
        <P>When we process information about people who interact with a client&rsquo;s social media account, we do so on that client&rsquo;s instructions. If you are visiting from the European Union or the United Kingdom, the grounds above correspond to consent, contract and legitimate interests under the GDPR.</P>
      </Section>

      <Section id="sharing" title="4. Who we share it with">
        <P>We do not sell personal information. We share it only with the service providers that help us run our business, who may process it only to provide their service to us:</P>
        <UL>
          <LI><strong>Zernio</strong> — connecting, posting to and reading comments and messages on social media accounts;</LI>
          <LI><strong>Vercel</strong> — hosting our website and app;</LI>
          <LI><strong>Google</strong> — Firebase Realtime Database (our main database), Gmail (our business inboxes), Google Drive and Google Calendar;</LI>
          <LI><strong>Cloudflare</strong> — file storage (R2) and video hosting (Stream);</LI>
          <LI><strong>Fly.io</strong> — hosting our video encoder;</LI>
          <LI><strong>Clerk</strong> — sign-in for our team and clients;</LI>
          <LI><strong>Anthropic</strong> — the Claude AI model that classifies incoming emails and helps keep prospect and client records up to date;</LI>
          <LI><strong>Inngest</strong> — running scheduled background jobs (such as publishing a post at its time);</LI>
          <LI><strong>SMTP2GO</strong> — sending email;</LI>
          <LI><strong>Stripe</strong> — taking booking payments;</LI>
          <LI><strong>HikerAPI, Apify and ScrapeCreators</strong> — reading publicly available Instagram information as described above;</LI>
          <LI><strong>Microsoft Clarity</strong> — website analytics;</LI>
          <LI><strong>Asana</strong> and <strong>Linktree</strong> — project tasks and link pages, where used for a client;</LI>
          <LI><strong>Meta, LinkedIn, TikTok and other social networks</strong> — when we publish or reply on a client&rsquo;s account, the content goes to that network.</LI>
        </UL>
        <P>Many of these providers store data outside Australia, including in the United States. We choose providers that protect personal information to a standard comparable with the Australian Privacy Principles. We may also disclose information where the law requires it.</P>
      </Section>

      <Section id="retention" title="5. How long we keep it">
        <UL>
          <LI>Client and project information: for as long as we work together, then for <Fill>[RETENTION PERIOD — e.g. 7 years for financial records]</Fill>.</LI>
          <LI>Leads and prospects who do not become clients: <Fill>[RETENTION PERIOD]</Fill> after our last contact.</LI>
          <LI>Follower, engagement, comment and automation records for a client&rsquo;s account: while we manage that account, and deleted within <Fill>[PERIOD]</Fill> after the client leaves us.</LI>
          <LI>Records of data deletion requests: kept so we can show the request was handled.</LI>
        </UL>
        <P>We do not yet delete data automatically on a timetable; a person on our team removes it. You can ask us to delete your information at any time (see below).</P>
      </Section>

      <Section id="security" title="6. How we keep it safe">
        <UL>
          <LI>The app is only available to signed-in team members and clients, or through private links we send to a client, and each person sees only what their role needs.</LI>
          <LI>Passwords and connection keys we hold are stored encrypted; social media access permissions are held by Zernio, not by us.</LI>
          <LI>All data travels over encrypted (HTTPS) connections.</LI>
          <LI>No system is perfectly secure. If a data breach is likely to cause serious harm, we will notify you and the Office of the Australian Information Commissioner as the Notifiable Data Breaches scheme requires.</LI>
        </UL>
      </Section>

      <Section id="rights" title="7. Your rights: access, correction and deletion">
        <P>You can ask us to:</P>
        <UL>
          <LI>tell you what personal information we hold about you and give you a copy;</LI>
          <LI>correct information that is wrong or out of date;</LI>
          <LI>delete your information; or</LI>
          <LI>stop sending you marketing emails.</LI>
        </UL>
        <P>
          Email <A href={MAIL}>{LEGAL_EMAIL}</A> (for deletion, use the subject line &ldquo;Data deletion&rdquo;) or follow the steps on our <A href="/data-deletion">data deletion page</A>. We may need to confirm who you are before acting. We will respond within 30 days. If we cannot do what you ask (for example, because the law requires us to keep a record), we will tell you why.
        </P>
        <P>
          If you are unhappy with how we handled your information, please tell us first so we can fix it. If you are still not satisfied, you can complain to the Office of the Australian Information Commissioner at <A href="https://www.oaic.gov.au">oaic.gov.au</A>.
        </P>
      </Section>

      <Section id="meta" title="8. Facebook, Instagram and other Meta platforms">
        <P>
          Meta&rsquo;s <A href="https://developers.facebook.com/terms/">Platform Terms</A> require us to explain how we handle information we receive from Meta&rsquo;s platforms (&ldquo;Platform Data&rdquo;). Today our access to Facebook and Instagram is through Zernio; if we connect to Meta directly through our own app, this section applies in the same way.
        </P>
        <H3>What Platform Data we process</H3>
        <UL>
          <LI>For accounts our clients connect: the account&rsquo;s ID, name, username and profile picture, and its connection status;</LI>
          <LI>the client&rsquo;s own posts and their performance figures (views, reach, likes, comments, shares, saves);</LI>
          <LI>comments on the client&rsquo;s posts and direct messages sent to the client&rsquo;s account, including the sender&rsquo;s username and display name;</LI>
          <LI>for comment-to-message automations a client switched on: the commenter&rsquo;s username, display name, comment, and the message we sent them.</LI>
        </UL>
        <H3>How and why we use it</H3>
        <UL>
          <LI>only to provide our social media management service to the client who connected the account: publishing their content, reporting on its results, and replying to comments and messages on their behalf;</LI>
          <LI>we do not sell Platform Data, use it for advertising profiles, or share it with anyone other than the processors listed in section 4 who help us provide the service.</LI>
        </UL>
        <P>
          Separately from Platform Data, the follower and engagement lists described in section 2 come from HikerAPI&rsquo;s reading of public Instagram information, not from Meta.
        </P>
        <H3>How to ask us to delete your data</H3>
        <UL>
          <LI>Email <A href={MAIL}>{LEGAL_EMAIL}</A> with the subject &ldquo;Data deletion&rdquo; and your Instagram or Facebook username; or</LI>
          <LI>if you have used our app through Facebook, remove it in your Facebook settings (Settings &amp; privacy &rarr; Settings &rarr; Apps and websites) and choose to send a deletion request. You will get a confirmation code you can check on our <A href="/data-deletion">data deletion page</A>.</LI>
        </UL>
        <P>A client can disconnect an account at any time, and we stop accessing it through Zernio from that point.</P>
      </Section>

      <Section id="children" title="9. Children">
        <P>Our services are for businesses, and we do not knowingly collect personal information from children under 16. If you believe a child has given us their information, contact us and we will delete it.</P>
      </Section>

      <Section id="changes" title="10. Changes to this policy">
        <P>We will update this policy when what we collect or how we use it changes. The date at the top shows the latest version. If a change is significant, we will tell our clients directly.</P>
      </Section>

      <Section id="contact" title="11. Contact us">
        <P>
          MD Media Marketing Pty Ltd<br />
          <Fill>[ADDRESS]</Fill><br />
          Email: <A href={MAIL}>{LEGAL_EMAIL}</A>
        </P>
      </Section>
    </LegalShell>
  )
}
