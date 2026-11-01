import type { Metadata } from 'next'
import { archivo, sometype } from '../components/lama/fonts'
import LogoWall from '../components/logo-wall/LogoWall'
import MdFooter from '../components/md-footer/MdFooter'
import MdNav from '../components/md-nav/MdNav'
import './campaign.css'

export const metadata: Metadata = {
  title: 'Campaign Shoots for Ecommerce Brands — MD Media, Melbourne',
  description:
    'Campaign shoots for ecommerce brands. We cast the models, run the full production and deliver evergreen content that lasts until your next drop. You don’t need to be there.',
  robots: 'index, follow',
  alternates: { canonical: 'https://www.mdmmarketing.com.au/campaign-shoots' },
  openGraph: {
    type: 'website',
    url: 'https://www.mdmmarketing.com.au/campaign-shoots',
    title: 'One shoot. The whole drop covered. — MD Media',
    description: 'Campaign shoots for ecommerce brands. Priced by project.',
    siteName: 'MD Media Marketing',
    locale: 'en_AU',
  },
}

const CALENDLY = 'https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone'
const pad = (i: number) => String(i + 1).padStart(2, '0')

// Display order from the copy: ecommerce first, then finance/property/trades/health, then hospitality.
const PROOF_BRANDS = [
  'Releeph', 'Alia Scents', 'Señorita Debutante Dresses', 'Park Noire', 'Hydra Wearables', 'DJI', 'Tilta', 'SmallRig',
  'Afterpay', 'HOKA', 'MoneyMe', 'Funday', 'Tixel', 'SkyBus', 'The Collagen Co.', 'One World Ecosolutions', 'Runway Room',
  'Shein Baby', 'Ellette', 'Sodii', 'Square', 'Somerset by Carter Grange', 'Addicted to Audio',
  'Real Deal', 'Kode Finance', 'Capra Financial Group', 'MGMT AUS', 'Intersign', 'Bond St Dental', 'StretchWorks',
  'Cecconi’s', 'The Waterside', 'Death & Co', 'Imperial Hotel', 'Skinny Dog Hotel', 'Prahran Hotel', 'Quarterhouse',
  'The Swan', 'The Provincial', 'Studley Park Boathouse', 'Public House', 'Prince Alfred', 'Richmond Club Hotel',
]

const steps = [
  ['Brief', 'We start with your vision for the drop and agree the creative direction together. Then we work backwards from there to plan the shoot.'],
  ['Send the product', 'Courier it to us. That’s your part done.'],
  ['We run the production', 'Casting and models, styling, location, crew and the shoot day. Martin, my co-founder, runs it.'],
  ['You get the library', 'Campaign images, video for ads and Reels, cut-downs in every format, and detail shots. Enough to post and advertise until your next drop.'],
  ['Next drop, repeat', ''],
]

// Counts are still [TO CONFIRM] in the copy — shown as the design has them until the numbers are in.
const deliverables = [
  { n: '00', tag: 'To confirm', title: 'Campaign images', desc: 'Hero, lookbook and lifestyle', media: 'get-images' },
  { n: '00', tag: 'To confirm', title: 'Videos for ads and Reels', desc: '9:16, 4:5 and 1:1', media: 'get-02' },
  { n: '00', tag: 'To confirm', title: 'Detail and texture shots', desc: 'Fabric, finish, close-ups', media: 'get-03' },
  { n: '01', tag: 'Included', title: 'Content plan', desc: 'What goes out when, so it lasts the whole drop', media: 'get-04' },
]

const crew = [
  'Creative Director — Martin', 'Strategist — Divina', 'Producer', 'Photographer', 'Cinematographer', 'Lighting & Grip',
  'Stylist', 'Hair & Makeup Artist', 'Casting Director', 'Set Designer', 'Production Assistant', 'Video Editor',
  'Retoucher', 'Social Content Creator',
]

const faqs = [
  ['Do I need to be at the shoot?', 'No. You send the product. We handle everything from casting to final edits.'],
  ['Can you match our brand’s look?', 'Yes. We work from your brand guidelines and past campaigns, and we lock the creative direction with you before shoot day.'],
  ['What happens to my products?', 'Returned after the shoot, or kept for samples.'],
  ['Who owns the content, and can I run it in ads?', 'Usage terms, including how long the model releases cover paid ads.'],
  ['How much does it cost?', 'It’s priced by project. It depends on the number of products, models and deliverables. I’ll give you a straight number on the call.'],
]

function BookButton({ dark = false }: { dark?: boolean }) {
  return (
    <a className={`cs-btn${dark ? ' cs-btn-dark' : ''}`} href={CALENDLY} target="_blank" rel="noreferrer noopener">
      Book your intro call ↗
    </a>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="cs-label">{children}</p>
}

export default function CampaignShootsPage() {
  return (
    <div className={`cs ${archivo.variable} ${sometype.variable}`}>
      <MdNav band />

      <main>
        {/* 1 — hero */}
        <section className="cs-wrap cs-hero">
          <div className="cs-hero-text">
            <p className="cs-meta"><span>Melbourne — Australia</span><span>For ecommerce brands</span><span>Priced by project</span></p>
            <h1 className="cs-h1">One shoot.<br />The whole drop covered.</h1>
            <p className="cs-sub">Campaign shoots for ecommerce brands. We cast the models, run the full production and deliver evergreen content that lasts until your next drop. You don’t need to be there.</p>
            <BookButton dark />
            <p className="cs-under">15 minutes. Tell me what’s dropping next.</p>
          </div>
          <div className="cs-hero-media">
            <video autoPlay muted loop playsInline preload="metadata" poster="/videos/campaign-shoots/hero-portrait.jpg" aria-label="Releeph Slow Mornings campaign, shot by MD Media">
              <source src="/videos/campaign-shoots/hero-portrait.mp4" type="video/mp4" />
            </video>
          </div>
          <p className="cs-side" aria-hidden="true">MD Media — Get seen. Get known. Get booked.</p>
        </section>

        {/* 2 — who it's for */}
        <section className="cs-wrap cs-sec">
          <Label>01 — Who it’s for</Label>
          <div className="cs-two">
            <div>
              <h2 className="cs-h3">This is for you if</h2>
              <ol className="cs-list">
                <li><span>01</span>You release drops or collections on a schedule</li>
                <li><span>02</span>Your launch content runs out halfway through the drop</li>
                <li><span>03</span>You’d rather run the business than run a shoot</li>
              </ol>
            </div>
            <div className="cs-dim">
              <h2 className="cs-h3">It’s not for you if</h2>
              <ul className="cs-list">
                <li><span>✕</span>You want a few product shots on a white background</li>
                <li><span>✕</span>You need it all by Friday</li>
              </ul>
            </div>
          </div>
        </section>

        {/* 3 — the problem */}
        <section className="cs-dark">
          <div className="cs-wrap cs-sec">
            <Label><span>02 — The problem</span><span>Launch content</span><span>Week 3 of 12</span></Label>
            <h2 className="cs-h2">Your drop lasts 3 months.<br />Your content lasts 3 weeks.</h2>
            <div className="cs-copy">
              <p>You shoot for launch and post the lot in the first fortnight. Then you spend the rest of the season recycling the same 6 photos, or shooting on your phone between orders.</p>
              <p>Your ads go stale. Your feed goes quiet. Sales slow down before the next drop has even landed.</p>
            </div>
            <div className="cs-stills">
              {[1, 2, 3, 4].map(n => (
                <figure key={n}>
                  <video autoPlay muted loop playsInline preload="metadata" poster={`/videos/campaign-shoots/still-0${n}.jpg`} aria-label={`Campaign shoot clip ${n}`}>
                    <source src={`/videos/campaign-shoots/still-0${n}.mp4`} type="video/mp4" />
                  </video>
                  <figcaption>/0{n}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        {/* 4 — how it works */}
        <section className="cs-wrap cs-sec">
          <Label>03 — How it works</Label>
          <h2 className="cs-h2">You send the box.<br />We do the rest.</h2>
          <div className="cs-how">
          <video className="cs-how-media" autoPlay muted loop playsInline preload="metadata" poster="/videos/campaign-shoots/how.jpg" aria-label="On location during an MD Media campaign shoot">
            <source src="/videos/campaign-shoots/how.mp4" type="video/mp4" />
          </video>
          <ol className="cs-steps">
            {steps.map(([t, d], i) => (
              <li key={t}>
                <span className="cs-num">{pad(i)}</span>
                <h3>{t}</h3>
                {d && <p>{d}</p>}
              </li>
            ))}
          </ol>
          </div>
          <BookButton dark />
        </section>

        {/* 5 — what you get */}
        <section className="cs-dark">
          <div className="cs-wrap cs-sec">
            <Label>04 — Per shoot</Label>
            <h2 className="cs-h2">What you get</h2>
            <div className="cs-cards">
              {deliverables.map(d => (
                <div key={d.title} className="cs-card">
                  <video className="cs-card-media" autoPlay muted loop playsInline preload="metadata" poster={`/videos/campaign-shoots/${d.media}.jpg`} aria-label={`${d.title}, from an MD Media shoot`}>
                    <source src={`/videos/campaign-shoots/${d.media}.mp4`} type="video/mp4" />
                  </video>
                  <div className="cs-card-top">
                    <span className="cs-big">{d.n}</span>
                    <span className={`cs-tag${d.tag === 'Included' ? ' cs-tag-ok' : ''}`}>{d.tag}</span>
                  </div>
                  <h3>{d.title}</h3>
                  <p>{d.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 6 — proof */}
        <section className="cs-wrap cs-sec">
          <Label>05 — Proof</Label>
          <h2 className="cs-h2">Shot by the team behind</h2>
          <LogoWall tone="light" hideTitle title="Shot by the team behind" brands={PROOF_BRANDS} textOnly={['Layer & Loom']} />
          <div className="cs-proof">
            <div className="cs-result">
              <p className="cs-label"><span>Result</span><span className="cs-tag">To confirm</span></p>
              <p className="cs-huge">—00%</p>
              <p>One ecom brand, one number. Ad cost down, or a sold-out drop.</p>
            </div>
            <div className="cs-quote">
              <div className="cs-slot cs-slot-34">Founder photo</div>
              <div>
                <span className="cs-tag">To confirm</span>
                <p className="cs-quote-text">“One line from an ecom founder on what changed.”</p>
                <p className="cs-label">Founder name, Brand</p>
              </div>
            </div>
          </div>
          <BookButton dark />
        </section>

        {/* 7 — about */}
        <section className="cs-wrap cs-sec cs-about">
          <video className="cs-about-media" autoPlay muted loop playsInline preload="metadata" poster="/videos/campaign-shoots/bts.jpg" aria-label="Behind the scenes and the result, Releeph campaign shoot">
            <source src="/videos/campaign-shoots/bts.mp4" type="video/mp4" />
          </video>
          <div>
            <Label><span>06 — About</span><span>Martin &amp; Divina</span></Label>
            <h2 className="cs-h2">Who’s running<br />your shoot</h2>
            <div className="cs-copy cs-copy-light">
              <p>MD Media is Martin and Divina, with a production team of 14. Martin runs production: the crew, the casting and the set. Divina runs the strategy, so every shot has a job once it’s live.</p>
              <p>You won’t be on set. We send you picks from the day, then the finished library.</p>
            </div>
            <div className="cs-crew">
              <p className="cs-label"><span>Your shoot crew</span><span>14 people</span></p>
              <ol>
                {crew.map((c, i) => <li key={c}><span>{pad(i)}</span>{c}</li>)}
              </ol>
            </div>
          </div>
        </section>

        {/* 8 + 9 — the call, FAQ */}
        <section className="cs-dark">
          <div className="cs-wrap cs-sec cs-two">
            <div>
              <Label>07 — The call</Label>
              <h2 className="cs-h3 cs-h3-big">What happens on the call</h2>
              <ol className="cs-list">
                <li><span>01</span>You book a 15-minute intro call.</li>
                <li><span>02</span>Tell me what’s dropping next, when, and where you sell.</li>
                <li><span>03</span>If we’re a fit, we book a proper call and I show you shoots like yours. If we’re not, I’ll tell you.</li>
              </ol>
            </div>
            <div>
              <Label>08 — FAQ</Label>
              <div className="cs-faq">
                {faqs.map(([q, a], i) => (
                  <details key={q} open={i === 0}>
                    <summary>{q}</summary>
                    <p>{a}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 10 — final call to action */}
        <section className="cs-wrap cs-sec cs-final">
          <h2 className="cs-h1">What’s your next drop?</h2>
          <div className="cs-final-row">
            <BookButton dark />
            <p className="cs-under">If we’re not the right fit, I’ll tell you on the call.</p>
          </div>
          <p className="cs-side" aria-hidden="true">MD Media — Campaign shoots</p>
        </section>
      </main>

      <MdFooter
        bar={
          <>
            <span>mdmmarketing.com.au · Melbourne, Australia</span>
            <span><a href="mailto:hello@mdmmarketing.com.au">hello@mdmmarketing.com.au</a></span>
          </>
        }
      />
    </div>
  )
}
