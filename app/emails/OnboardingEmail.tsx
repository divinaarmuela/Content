import {
  Body, Column, Container, Head, Heading, Hr, Html, Img, Link, Preview, Row, Section, Text,
} from '@react-email/components'
import { brandAssetsUrl, type OnboardingDraft, type OnboardingStep } from '../lib/onboarding-email-core'

/**
 * THE WELCOME EMAIL, AS A REACT EMAIL TEMPLATE (the owner, 13 Nov 2026: "can we use a react email … look at this
 * design, so nice with images, use what we have"). A dark page, a large headline in the website's own type, MD Media's own photographs,
 * picture-and-words rows that swap sides, one cream card for the portal. The words come from the draft
 * (onboarding-email-core); a part left empty is left out.
 *
 * No hooks, no browser APIs: the same component renders on the server (to send) and in the browser (the preview).
 */

export const ONBOARDING_LOOK = {
  page: '#0C0C0E', ink: '#0C0C0E', cream: '#F4F1EA', soft: '#B9B5AB', faint: '#7E7B74', line: '#2A2A2E',
  blue: '#1838E0', sky: '#9DB0FF',
  // the website's own (globals.css --sans and --mono); a mail app that drops web fonts shows Helvetica or Arial
  sans: "'Inter Tight', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  mono: "'JetBrains Mono', 'Courier New', monospace",
} as const
const L = ONBOARDING_LOOK

/** where the footer's three links go: the public site, the agency's Instagram (the same one the site footer uses), the shared inbox */
export const ONBOARDING_FOOTER_LINKS = {
  website: 'https://www.mdmmarketing.com.au',
  instagram: 'https://www.instagram.com/mdmedia._',
  email: 'mailto:hello@mdmmarketing.com.au',
} as const

/** the picture beside each "what you will see" row, in order: the portal's four tabs */
// see-through pictures of the phone alone: nothing around it to show as a box when a mail app changes the background
export const ONBOARDING_IMAGES = ['shoot-brief.png', 'editing.png', 'designing.png', 'scheduling.png'] as const

const lines = (t: string) => t.trim().split('\n').map((l, i, all) => <span key={i}>{l}{i < all.length - 1 && <br />}</span>)

// 28px each side on every screen: a pasted email loses its phone-only rules in Gmail, so nothing may depend on them
const pad = { padding: '0 28px' }
// the small section labels: the BODY font in capitals (the owner, 13 Nov 2026: "I don't love the font on 'A set up call', can we
// use the same font as body but capitals")
const eyebrow = { margin: '0 0 18px', fontFamily: L.sans, fontSize: 12, lineHeight: '16px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: L.sky }
const display = { margin: 0, fontFamily: L.sans, fontWeight: 700, color: L.cream, letterSpacing: '-0.035em', textWrap: 'balance' as const }
const body = { margin: '0 0 14px', fontFamily: L.sans, fontSize: 16, lineHeight: '26px', color: L.cream }

// each link stays whole: on a narrow phone the row wraps BETWEEN links, never inside one
const footLink = { color: ONBOARDING_LOOK.cream, textDecoration: 'none', whiteSpace: 'nowrap' as const, display: 'inline-block' }

function Arrow({ href, children, color = L.cream }: { href: string; children: React.ReactNode; color?: string }) {
  return <Link href={href} style={{ fontFamily: L.sans, fontSize: 15, lineHeight: '22px', fontWeight: 700, color, textDecoration: 'none' }}>{children} &rarr;</Link>
}

function Pill({ href, children, bg, color }: { href: string; children: React.ReactNode; bg: string; color: string }) {
  return (
    <Link href={href} style={{ display: 'inline-block', padding: '14px 22px', borderRadius: 999, backgroundColor: bg, fontFamily: L.sans, fontSize: 12, lineHeight: '16px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color, textDecoration: 'none', whiteSpace: 'nowrap' }}>
      {children}&nbsp;&rarr;
    </Link>
  )
}

/**
 * A picture beside its words; the side swaps row by row. NO PHONE-ONLY RULES: Gmail drops them from a pasted email,
 * which left the two halves squeezed side by side on a phone (the owner's phone, 13 Nov 2026). These are two blocks
 * that sit side by side when the screen has room for both and fall one under the other when it does not. The swap is
 * done by reading direction, which every mail app keeps; stacked, the picture is always on top.
 */
function Feature({ step, img, flip }: { step: OnboardingStep; img: string | null; flip: boolean }) {
  const half = { display: 'inline-block', width: '100%', verticalAlign: 'middle', direction: 'ltr' as const }
  return (
    <Section style={{ marginBottom: 44 }}>
      <div dir={flip ? 'rtl' : 'ltr'} style={{ textAlign: 'center', fontSize: 0, direction: flip ? 'rtl' : 'ltr' }}>
        {img && (
          <div style={{ ...half, maxWidth: 250 }}>
            <Img src={img} alt="" width="210" style={{ display: 'block', width: '100%', maxWidth: 210, height: 'auto', border: 0, margin: '0 auto' }} />
          </div>
        )}
        <div dir="ltr" style={{ ...half, maxWidth: img ? 334 : 584, textAlign: 'left' }}>
          <div style={{ padding: '18px 0' }}>
            <Text style={{ margin: '0 0 8px', fontFamily: L.sans, fontSize: 22, lineHeight: '28px', fontWeight: 700, letterSpacing: '-0.02em', color: L.cream }}>{step.title.trim()}</Text>
            {step.body.trim() && <Text style={{ ...body, margin: 0, fontSize: 15, lineHeight: '24px', color: L.soft }}>{lines(step.body)}</Text>}
          </div>
        </div>
      </div>
    </Section>
  )
}

export default function OnboardingEmail({ draft: d, portalUrl, assetBase, brandTab = true }: {
  /** false for a client still on the old portal, which has no Brand assets tab: the button is left out */
  brandTab?: boolean
  draft: OnboardingDraft
  portalUrl: string | null
  /** where the pictures and the logo are served from, no trailing slash: https://app…/ */
  assetBase: string
}) {
  const asset = (f: string) => `${assetBase}/email/onboarding/${f}`
  const agreed = d.agreed.filter(r => r.label.trim() || r.value.trim())
  const see = d.see.filter(s => s.title.trim() || s.body.trim())
  const next = d.next.filter(s => s.title.trim() || s.body.trim())
  const showCall = !!(d.callBody.trim() || d.callUrl)

  return (
    <Html lang="en">
      <Head>
        {/* the fonts are imported by hand: React Email's <Font> also sets its font on every element */}
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap');
          @media only screen and (max-width: 520px) {
            .pad { padding-left: 22px !important; padding-right: 22px !important; }
            .hero { font-size: 34px !important; line-height: 38px !important; }
            .h2 { font-size: 26px !important; line-height: 32px !important; }
          }
        `}</style>
      </Head>
      <Preview>{d.intro.trim().slice(0, 140)}</Preview>
      <Body style={{ margin: 0, padding: 0, backgroundColor: L.page }}>
        <Container style={{ width: '100%', maxWidth: 640, margin: '0 auto', backgroundColor: L.ink }}>

          {/* ── logo ── */}
          <Section className="pad" style={{ ...pad, paddingTop: 36 }}>
            {/* ON ITS OWN DARK CHIP, baked into the picture: white letters and the blue slash stay readable when a mail app
                turns the email light, and the logo itself is never inverted */}
            <Img src={asset('logo-chip.png')} alt="MD Media" height="40" style={{ display: 'block', height: 40, width: 'auto', border: 0, marginLeft: -11 }} />
          </Section>

          {/* ── hello ── */}
          <Section className="pad" style={{ ...pad, paddingTop: 48, paddingBottom: 40 }}>
            <Heading as="h1" className="hero" style={{ ...display, fontSize: 40, lineHeight: '44px' }}>{d.greeting.trim() || 'Welcome'}</Heading>
            {d.intro.trim() && <Text style={{ ...body, margin: '18px 0 0', maxWidth: 480 }}>{lines(d.intro)}</Text>}
          </Section>
          <Img src={asset('hero.jpg')} alt="The people at MD Media" width="640" style={{ display: 'block', width: '100%', height: 'auto', border: 0 }} />

          {/* ── what we agreed ── */}
          {agreed.length > 0 && (
            <Section className="pad" style={{ ...pad, paddingTop: 72 }}>
              <Heading as="h2" className="h2" style={{ ...display, fontSize: 30, lineHeight: '36px', marginBottom: 28 }}>{d.agreedTitle.trim()}</Heading>
              {agreed.map((r, i) => (
                <Section key={i} style={{ borderTop: `1px solid ${L.line}`, padding: '16px 0' }}>
                  <Text style={{ ...eyebrow, margin: '0 0 4px', color: L.faint }}>{r.label.trim()}</Text>
                  <Text style={{ ...body, margin: 0 }}>{lines(r.value)}</Text>
                </Section>
              ))}
              <Hr style={{ margin: 0, borderColor: L.line, borderTopWidth: 1 }} />
            </Section>
          )}

          {/* ── how we work ── */}
          {(d.workHeadline.trim() || d.workBody.trim()) && (
            <Section className="pad" style={{ ...pad, paddingTop: 72 }}>
              <Text style={eyebrow}>{d.workTitle.trim()}</Text>
              {d.workHeadline.trim() && <Heading as="h2" className="h2" style={{ ...display, fontSize: 30, lineHeight: '36px' }}>{d.workHeadline.trim()}</Heading>}
              {d.workBody.trim() && <Text style={{ ...body, margin: '22px 0 0', color: L.soft, maxWidth: 500 }}>{lines(d.workBody)}</Text>}
            </Section>
          )}

          {/* ── what you will see: picture and words, swapping sides ── */}
          {see.length > 0 && (
            <Section className="pad" style={{ ...pad, paddingTop: 80 }}>
              <Heading as="h2" className="h2" style={{ ...display, fontSize: 30, lineHeight: '36px' }}>{d.seeTitle.trim()}</Heading>
              {d.seeIntro.trim() && <Text style={{ ...body, margin: '14px 0 0', color: L.soft }}>{d.seeIntro.trim()}</Text>}
              <Section style={{ paddingTop: 40 }}>
                {see.map((s, i) => <Feature key={i} step={s} flip={i % 2 === 1} img={ONBOARDING_IMAGES[i] ? asset(ONBOARDING_IMAGES[i]) : null} />)}
              </Section>
            </Section>
          )}

          {/* ── the portal: the one cream card ── */}
          {portalUrl && (
            <Section className="pad" style={{ ...pad, paddingTop: 32 }}>
              <Section className="card" style={{ backgroundColor: L.cream, padding: '44px 22px', textAlign: 'center' }}>
                <Text style={{ ...eyebrow, color: L.blue }}>{d.portalTitle.trim()}</Text>
                <Text style={{ margin: '0 auto 26px', maxWidth: 420, fontFamily: L.sans, fontSize: 21, lineHeight: '29px', fontWeight: 600, letterSpacing: '-0.02em', color: L.ink, textWrap: 'balance' }}>{lines(d.portalBody)}</Text>
                <Pill href={portalUrl} bg={L.blue} color="#FFFFFF">{d.portalButton.trim() || 'Open your portal'}</Pill>
              </Section>
            </Section>
          )}

          {/* ── what we still need, and a call ── */}
          {d.needBody.trim() && (
            <Section className="pad" style={{ ...pad, paddingTop: 72 }}>
              <Text style={eyebrow}>{d.needTitle.trim()}</Text>
              <Text style={{ ...body, margin: 0, fontSize: 18, lineHeight: '30px' }}>{lines(d.needBody)}</Text>
              {/* straight to the portal's Brand assets tab, where they add the files themselves (13 Nov 2026) */}
              {portalUrl && brandTab && d.needButton.trim() && (
                <Text style={{ margin: '22px 0 0' }}><Pill href={brandAssetsUrl(portalUrl)} bg={L.cream} color={L.ink}>{d.needButton.trim()}</Pill></Text>
              )}
            </Section>
          )}
          {showCall && (
            <Section className="pad" style={{ ...pad, paddingTop: 56 }}>
              <Text style={eyebrow}>{d.callTitle.trim()}</Text>
              {d.callBody.trim() && <Text style={{ ...body, margin: '0 0 22px', fontSize: 18, lineHeight: '30px' }}>{lines(d.callBody)}</Text>}
              {d.callUrl && d.callButton.trim() && <Pill href={d.callUrl} bg={L.cream} color={L.ink}>{d.callButton.trim()}</Pill>}
            </Section>
          )}

          {/* ── what happens next ── */}
          {next.length > 0 && (
            <Section className="pad" style={{ ...pad, paddingTop: 80 }}>
              <Heading as="h2" className="h2" style={{ ...display, fontSize: 30, lineHeight: '36px', marginBottom: 28 }}>{d.nextTitle.trim()}</Heading>
              {next.map((s, i) => (
                <Row key={i} style={{ borderTop: `1px solid ${L.line}` }}>
                  <Column style={{ width: 56, verticalAlign: 'top', padding: '20px 0' }}>
                    <Text style={{ margin: 0, fontFamily: L.mono, fontSize: 15, lineHeight: '28px', fontWeight: 600, letterSpacing: '0.08em', color: L.sky }}>{String(i + 1).padStart(2, '0')}</Text>
                  </Column>
                  <Column style={{ verticalAlign: 'top', padding: '22px 0' }}>
                    <Text style={{ margin: 0, fontFamily: L.sans, fontSize: 17, lineHeight: '24px', fontWeight: 700, color: L.cream }}>{s.title.trim()}</Text>
                    {s.body.trim() && <Text style={{ ...body, margin: '4px 0 0', fontSize: 15, lineHeight: '24px', color: L.soft }}>{lines(s.body)}</Text>}
                  </Column>
                </Row>
              ))}
              <Hr style={{ margin: 0, borderColor: L.line, borderTopWidth: 1 }} />
            </Section>
          )}

          {/* ── goodbye ── */}
          <Section className="pad" style={{ ...pad, paddingTop: 64, paddingBottom: 56 }}>
            {d.signoff.trim() && <Text style={{ ...body, margin: '0 0 18px' }}>{lines(d.signoff)}</Text>}
            {d.signature.trim() && <Text style={{ margin: 0, fontFamily: L.sans, fontSize: 24, lineHeight: '30px', fontWeight: 700, letterSpacing: '-0.02em', color: L.cream }}>{d.signature.trim()}</Text>}
            <Text style={{ margin: '6px 0 0' }}><Arrow href="mailto:hello@mdmmarketing.com.au" color={L.sky}>hello@mdmmarketing.com.au</Arrow></Text>
          </Section>
          <Hr style={{ margin: 0, borderColor: L.line, borderTopWidth: 1 }} />
          {/* the footer of the email info@ liked (the owner, 13 Nov 2026: "why didn't add this in the footer"): what we do, three links, where we are */}
          <Section className="pad" style={{ ...pad, paddingTop: 40, paddingBottom: 48, textAlign: 'center' }}>
            <Text style={{ margin: 0, fontFamily: L.sans, fontSize: 16, lineHeight: '24px', color: L.soft }}>Get seen. Get known. Get booked.</Text>
            <Text style={{ margin: '26px 0 0', fontFamily: L.mono, fontSize: 11, lineHeight: '26px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: L.cream }}>
              <Link href={ONBOARDING_FOOTER_LINKS.website} style={footLink}>Website</Link>
              <span style={{ color: L.faint }}> &middot; </span>
              <Link href={ONBOARDING_FOOTER_LINKS.instagram} style={footLink}>Instagram</Link>
              <span style={{ color: L.faint }}> &middot; </span>
              <Link href={ONBOARDING_FOOTER_LINKS.email} style={footLink}>Email us</Link>
            </Text>
            <Text style={{ margin: '26px 0 0', fontFamily: L.mono, fontSize: 11, lineHeight: '18px', letterSpacing: '0.16em', textTransform: 'uppercase', color: L.faint }}>Melbourne, Australia</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}
