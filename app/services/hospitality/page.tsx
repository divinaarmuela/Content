import type { Metadata } from 'next'
import { archivo, sometype } from '../../components/lama/fonts'
import LazyLoop from '../../components/lazy-loop/LazyLoop'
import MdNav from '../../components/md-nav/MdNav'
import { logoFile } from '../../components/logo-wall/LogoWall'
import SmileStrip from './SmileStrip'
import '../../components/service-page/service-page.css'
import './hospitality.css'
import { bookCallHref } from '../../lib/book-call-core'

/**
 * /services/hospitality — the landing page Meta ads for venue owners point at (11 Nov 2026, the owner: "the best structure for a
 * hospitality landing page, my team will run ads and we will be using this page to showcase the hospitality").
 * One goal: book the 10-minute call. No site menu, no footer links; every button goes to /book-call (the one booking
 * page). Structure from the research (Unbounce attention ratio, Bambrick's venue + number proof, web.dev video).
 *
 * MEDIA: the owner's 22 files of 11 Nov (Murray Cod … MDM00158), compressed into public/hospitality/: videos are
 * silent web loops (0.5–2 MB, endings trimmed) with a poster each; photos 1400px, ~60–230 KB.
 * Still placeholders: the result NUMBERS (real figures only), the owner quote, the ad's exact headline.
 */
export const metadata: Metadata = {
  title: 'Hospitality marketing — MD Media, Melbourne',
  description: 'Content, social and ads that fill Melbourne venues. Explore your options in a free 10-minute call.',
  robots: 'index, follow', // in the site's Services menu since 11 Nov 2026, so searchable too
  alternates: { canonical: 'https://www.mdmmarketing.com.au/services/hospitality' },
}

// every button goes to the ONE booking page (owner, 11 Nov 2026: booking lives on /book-call, not embedded here);
// UtmPassthrough adds &from=/services/hospitality on click, so Leads shows "Booked from: Hospitality" with the ad's tags
const BOOK = bookCallHref('hospitality')
const M = '/hospitality'

// venues we have no footage of on this page yet: named in one line under the photo strip (owner, 11 Nov 2026:
// "why don't use this section for the images we have" — the names band became the strip of the work itself)
// the hospitality clients from LogoWall's BRANDS (each has a logo file in /public/logos/content-visibility)
const HOSPITALITY_LOGOS = ['Cecconi’s', 'The Waterside', 'Death & Co', 'Imperial Hotel', 'Prahran Hotel', 'The Swan', 'The Provincial',
  'Studley Park Boathouse', 'Public House', 'Prince Alfred', 'Richmond Club Hotel', 'Skinny Dog Hotel', 'Quarterhouse']

/**
 * THE WORK AS A ZIGZAG (owner, 11 Nov 2026: "can't u make a zigzag section? … everything is like a grid"). One row per
 * venue, alternating sides: a collage (main Reel, an overlapping still, a second Reel) against the venue's story.
 */
type Story = {
  n: string; venue: string; kind: string; line: string; made: string[]
  reel: { src: string; title: string }; second?: { src: string; title: string }
  /** a landscape film that leads the collage (The Waterside venue film); the reel then overlaps it */
  wide?: { src: string; title: string }
  still: { src: string; alt: string }; thumbs: { src: string; alt: string }[]
}
const STORIES: Story[] = [
  {
    n: '01', venue: 'Cecconi’s', kind: 'Fine dining · Toorak & Flinders Lane',
    line: 'Editorial content for one of Melbourne’s most recognised Italian dining rooms. A new menu, a caviar service, a long lunch: each told the way the kitchen intends it.',
    made: ['Menu launch film', 'Chef process Reels', 'Editorial photography', 'Paid social'],
    reel: { src: 'cecconis-caviar', title: 'Caviar & champagne' },
    second: { src: 'cecconis-murray-cod', title: 'Murray cod, built to order' },
    still: { src: 'cecconis-pappardelle', alt: 'Twirling pappardelle at Cecconi’s' },
    thumbs: [{ src: 'cecconis-steak-jus', alt: 'Jus poured over sliced steak' }, { src: 'cecconis-cocktail', alt: 'Sour with edible flowers' }],
  },
  {
    n: '02', venue: 'The Glass Den', kind: 'Café & brunch · inside an old prison',
    line: 'A brunch spot with a story most people walk past. We made the room, the people and the signature plates the reason to come in.',
    made: ['Venue film', 'Signature dish Reels', 'Food & drink photography'],
    reel: { src: 'glass-den-overall', title: 'A morning at the Den' },
    second: { src: 'glass-den-chilli-crab', title: 'Chilli crab scramble' },
    still: { src: 'glass-den-hot-chocolate', alt: 'Hot chocolate pour, The Glass Den' },
    thumbs: [{ src: 'glass-den-chilli-crab', alt: 'Chilli crab scramble on brioche' }, { src: 'glass-den-desserts', alt: 'The dessert spread' }],
  },
  {
    n: '03', venue: 'The Waterside', kind: 'King & Flinders · venue and Past/Port restaurant',
    line: 'A landmark venue on King & Flinders: bars, terraces, dining rooms and function spaces. A venue film that shows the whole building, and seasonal campaigns that fill it, like Lunar New Year at Past/Port.',
    made: ['Venue film', 'Drone & interiors', 'Seasonal campaign Reel', 'Event promotion'],
    wide: { src: 'waterside-venue-wide', title: 'The Waterside venue film' },
    reel: { src: 'pastport-lunar-new-year', title: 'Lunar New Year' },
    still: { src: 'pastport-lunar-card', alt: 'Yee sang toss with a red envelope' },
    thumbs: [],
  },
]
const LONG_LUNCH = { src: 'cecconis-duck-wide', title: 'Long lunch, Cecconi’s' }

const PHOTOS: { src: string; alt: string }[] = [
  { src: 'cecconis-pappardelle', alt: 'Twirling pappardelle at Cecconi’s' },
  { src: 'glass-den-chilli-crab', alt: 'Chilli crab scramble on brioche, The Glass Den' },
  { src: 'cecconis-steak-jus', alt: 'Jus poured over sliced steak, Cecconi’s' },
  { src: 'glass-den-hot-chocolate', alt: 'Hot chocolate pour, The Glass Den' },
  { src: 'cecconis-cocktail', alt: 'Sour with edible flowers, Cecconi’s' },
  { src: 'chef-ribeye', alt: 'Chef with a rib-eye on the bone' },
  { src: 'glass-den-spread', alt: 'Brunch spread, The Glass Den' },
  { src: 'cecconis-seared-fish', alt: 'Seared fish and white wine, Cecconi’s' },
  { src: 'glass-den-french-toast', alt: 'Chocolate over French toast, The Glass Den' },
  { src: 'cecconis-spread', alt: 'An overhead table spread, Cecconi’s' },
  { src: 'glass-den-squid-ink', alt: 'Squid-ink spaghetti with roe' },
  { src: 'cecconis-lamb-carve', alt: 'Lamb rack carved at the table' },
  { src: 'glass-den-desserts', alt: 'The dessert spread, The Glass Den' },
  { src: 'cecconis-pasta', alt: 'Pasta with parmesan, Cecconi’s' },
  { src: 'cecconis-gnocchi-wine', alt: 'Gnocchi, bread and a bottle presented' },
]


const STEPS = [
  ['Shoot day', 'One half-day at your venue: food, the room, your people, service. We plan it with you; you run service as normal.'],
  ['Monthly content', 'A month of posts and Reels, edited, captioned and scheduled for Instagram and Facebook. You approve before anything goes out.'],
  ['Ads that book tables', 'The best of it runs as Meta ads to locals most likely to book, with every booking tracked back to the ad.'],
]

const FAQS: [string, string][] = [
  ['What does it cost?', 'It depends on how many venues and how much content. On the call we’ll give you a straight number.'],
  ['Is there a lock-in contract?', 'Placeholder: your answer on contract length.'],
  ['We already have someone doing our social.', 'Placeholder: how you work alongside an in-house person.'],
  ['How much of my time does a shoot take?', 'Placeholder: e.g. a 15-minute brief, then we work around service.'],
  ['Do you work with new venues?', 'Placeholder: openings and launches as well as established venues.'],
  ['Is it Melbourne only?', 'Placeholder: where you shoot.'],
]

function Slot({ label, ratio }: { label: string; ratio: string }) {
  return <div className="hx-slot" style={{ aspectRatio: ratio }}><span>{label}</span></div>
}

export default function HospitalityPage() {
  return (
    <div className={`${archivo.variable} ${sometype.variable}`}>
      <main className="cv hx">
        {/* the site's own navbar (owner, 11 Nov 2026: "where is the navbar button"): links, Services, the phone ☰ menu,
            Book a call. The dark band keeps its white logo and links readable on this light page. */}
        <MdNav band />

        {/* 1. HERO: message match with the ad, one button; the vertical new-menu film beside it */}
        <section className="cv-wrap hx-hero">
          <div>
            <h1 className="cv-h1">Content that <em>fills</em> Melbourne venues.</h1>
            <p className="cv-lead">We shoot, post and advertise for Melbourne restaurants, bars and venues, so locals see you and book a table.</p>
            <a href={BOOK} className="hx-btn">Explore your options</a>
            <p className="hx-note">Free · 10 minutes · no obligation</p>
          </div>
          <div className="hx-hero-film">
            <video src={`${M}/cecconis-new-menu.mp4`} poster={`${M}/cecconis-new-menu.jpg`} autoPlay muted loop playsInline preload="auto" aria-label="Cecconi’s new menu, shot by MD Media" />
          </div>
        </section>

        {/* 2. TRUSTED BY: the client logos, the same files as the other pages' logo wall (owner, 11 Nov 2026: "the
            client logo we have in other pages"), dark on the light page. The Glass Den has no logo file yet: its name. */}
        <div className="hx-trusted">
          
          {/* a straight, endless marquee of the logos (owner: "this marquee too, the logos"); pauses on hover */}
          <div className="hx-logos" aria-label="Trusted by Melbourne venues">
            <ul className="hx-logos-track">
              {[0, 1].map(copy => [
                ...HOSPITALITY_LOGOS.map(b => (
                  <li key={`${b}-${copy}`} aria-hidden={copy === 1}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/logos/content-visibility/${logoFile(b)}.png`} alt={copy === 0 ? b : ''} loading="lazy" />
                  </li>
                )),
                <li key={`glass-den-${copy}`} className="hx-logo-text" aria-hidden={copy === 1}>The Glass Den</li>,
              ])}
            </ul>
          </div>
        </div>

        {/* 3. THE WORK: Reels (swipe row on phones; each loads only when scrolled near), then the stills */}
        <section className="cv-wrap hx-sec">
          <div className="hx-head">
            <div>
              <h2 className="hx-h2">Shot the way the kitchen intends it.</h2>
            </div>
            <p className="hx-narrow">Reels, stills and campaigns for Melbourne venues, from fine dining to brunch. Every piece here is our own work.</p>
          </div>
          <div className="hx-zig">
            {STORIES.map(s => (
              <article key={s.venue} className="hx-zig-row">
                {/* the collage: main Reel, an overlapping still, a second Reel tucked behind */}
                <div className={`hx-collage${s.wide ? ' hx-collage-wide' : s.second ? '' : ' hx-collage-solo'}`}>
                  {s.wide && (
                    <figure className="hx-col-wide">
                      <LazyLoop className="hx-fill" src={`${M}/${s.wide.src}`} label={`${s.wide.title}, ${s.venue}`} />
                    </figure>
                  )}
                  <figure className="hx-col-main">
                    <LazyLoop className="hx-fill" src={`${M}/${s.reel.src}`} label={`${s.reel.title}, ${s.venue}`} />
                  </figure>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="hx-col-still" src={`${M}/${s.still.src}.jpg`} alt={s.still.alt} loading="lazy" decoding="async" />
                  {s.second && (
                    <figure className="hx-col-second">
                      <LazyLoop className="hx-fill" src={`${M}/${s.second.src}`} label={`${s.second.title}, ${s.venue}`} />
                    </figure>
                  )}
                </div>
                {/* the story */}
                <div className="hx-story">
                  <h3 className="hx-story-venue">{s.venue}</h3>
                  <p className="hx-story-line">{s.line}</p>
                  <ul className="hx-story-made">{s.made.map(m => <li key={m}>{m}</li>)}</ul>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* one wide moment: the long lunch, full bleed with a line over it */}
        {/* every still, on a smile-shaped marquee (owner, 11 Nov 2026) */}
        <SmileStrip photos={PHOTOS} />

        <section className="hx-wide">
          <LazyLoop className="hx-fill" src={`${M}/${LONG_LUNCH.src}`} label={LONG_LUNCH.title} />
          <div className="hx-wide-text cv-wrap">
            <p className="hx-wide-line">The table people book for.</p>
            <a href={BOOK} className="hx-btn hx-btn-light">See what we’d do for your venue</a>
          </div>
        </section>

        {/* RESULTS: removed until there are real numbers (owner, 11 Nov 2026: "we don’t have the data").
            Bring it back as venue + real figure only, never placeholders. */}

        {/* 5. HOW IT WORKS */}
        <section className="cv-wrap hx-sec">
          <div className="hx-head">
            <div>
              <h2 className="hx-h2">One team. Shoot, post, advertise.</h2>
            </div>
          </div>
          <ol className="hx-steps">
            {STEPS.map(([t, d], i) => (
              <li key={t}><span className="hx-step-n">0{i + 1}</span><p className="hx-step-t">{t}</p><p className="hx-step-d">{d}</p></li>
            ))}
          </ol>
        </section>

        {/* 6. AN OWNER SAYS: the one dark moment on a light page */}
        <div className="hx-quote-wrap">
          <section className="cv-wrap hx-quote">
            <Slot label="[ Owner video, 20 sec, or photo ]" ratio="4 / 5" />
            <blockquote>
              <p>“Placeholder: one or two sentences from an owner or GM, in their words.”</p>
              <p className="hx-cite">Name · Role, Venue</p>
            </blockquote>
          </section>
        </div>

        {/* 7. QUESTIONS */}
        <section className="cv-wrap hx-sec hx-faq-grid">
          <div>
            <h2 className="hx-h2">What owners ask us first.</h2>
          </div>
          <div className="hx-faq">
            {FAQS.map(([q, a]) => (
              <details key={q}><summary>{q}</summary><p>{a}</p></details>
            ))}
          </div>
        </section>

        {/* 8. LAST CALL TO ACTION: a button to /book-call, not a calendar (one booking page for the whole site) */}
        <section className="cv-wrap hx-sec hx-book">
          <h2 className="cv-h1 hx-book-h">Let’s talk about your venue.</h2>
          <p className="cv-lead">Tell us about your venue. We’ll tell you honestly what we’d do and what it would cost.</p>
          <a href={BOOK} className="hx-btn">Explore your options</a>
          <p className="hx-note">Free · 10 minutes · no obligation</p>
        </section>

        <div className="cv-wrap hx-foot">© MD Media Marketing Pty Ltd · ABN 75 681 730 512 · <a href="/privacy">Privacy</a></div>
      </main>
    </div>
  )
}
