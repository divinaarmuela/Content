import FaqList from '../components/FaqList'
import ContactForm from '../components/ContactForm'
import ScrollObserver from '../components/ScrollObserver'

export default function ContentPage() {
  return (
    <>
      <main>

        {/* HERO */}
        <section className="hero">
          <div className="hero-bg">
            <img
              src="https://static.wixstatic.com/media/c5a69a_8ff71d938a1447a1b0987a2bb9272b1c~mv2.jpg/v1/fill/w_1920,h_1080,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/c5a69a_8ff71d938a1447a1b0987a2bb9272b1c~mv2.jpg"
              alt=""
              aria-hidden="true"
            />
            <div className="hero-overlay" />
          </div>
          <div className="container hero-inner">
            <p className="hero-tagline">Content Production &amp; Creative Assets</p>
            <h1 className="hero-h1">Content that gets likes<br />is a hobby. Content that<br /><span style={{ color: 'var(--blue)' }}>converts</span> is a business.</h1>
            <p className="hero-desc">
              Photography, video, and copy engineered to sell.{' '}
              <strong style={{ color: 'var(--bg)' }}>Subscription or project-based.</strong>{' '}
              Melbourne studio, Australia-wide production.
            </p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '36px', flexWrap: 'wrap' }}>
              <a href="#apply" className="btn">Book production <span className="arr">→</span></a>
              <a href="#models" className="btn btn-outline">See models <span className="arr">→</span></a>
            </div>
          </div>
        </section>

        {/* STUDIO STATS STRIP */}
        <div className="stats-strip">
          <div className="container stats-inner">
            <div className="stat-item">
              <span className="stat-val">500+</span>
              <span className="stat-label">Assets / month</span>
            </div>
            <div className="stat-div" />
            <div className="stat-item">
              <span className="stat-val">15</span>
              <span className="stat-label">In-house crew</span>
            </div>
            <div className="stat-div" />
            <div className="stat-item">
              <span className="stat-val">22</span>
              <span className="stat-label">Shoots / month</span>
            </div>
            <div className="stat-div" />
            <div className="stat-item">
              <span className="stat-val blue">21 days</span>
              <span className="stat-label">Brief to publish</span>
            </div>
            <div className="stat-div" />
            <div className="stat-item">
              <span className="stat-val">Pod-based</span>
              <span className="stat-label">Production model</span>
            </div>
          </div>
        </div>

        {/* MARQUEE */}
        <div className="marquee" aria-hidden="true">
          <div className="marquee-track">
            <span className="marquee-item">
              LIKES ≠ LEADS <span className="marquee-dot">●</span> ONE CRAFT NOT THREE{' '}
              <span className="marquee-dot">●</span> IN-HOUSE PRODUCTION{' '}
              <span className="marquee-dot">●</span> ENGINEERED TO SELL{' '}
              <span className="marquee-dot">●</span> PHOTO / VIDEO / COPY{' '}
              <span className="marquee-dot">●</span>
            </span>
            <span className="marquee-item">
              LIKES ≠ LEADS <span className="marquee-dot">●</span> ONE CRAFT NOT THREE{' '}
              <span className="marquee-dot">●</span> IN-HOUSE PRODUCTION{' '}
              <span className="marquee-dot">●</span> ENGINEERED TO SELL{' '}
              <span className="marquee-dot">●</span> PHOTO / VIDEO / COPY{' '}
              <span className="marquee-dot">●</span>
            </span>
          </div>
        </div>

        {/* PROBLEM */}
        <section>
          <div className="container">
            <h2 className="section-title">
              Beautiful content that doesn&apos;t <span className="blue">do anything.</span>
            </h2>
            <p className="section-lede">
              Most content gets produced to fill a calendar. Nobody asks if it actually sells. Then the
              reporting lands, and{' '}
              <strong>nobody can explain why the spend didn&apos;t move anything</strong>.
            </p>

            <div className="diagnostic-grid">
              <div className="diagnostic fade-up">
                <div className="diag-head">
                  <span className="diag-id">ERR_01</span>
                  <span className="diag-status">PRETTY ONLY</span>
                </div>
                <h3>Looks great. <span className="blue">Says nothing.</span></h3>
                <p>Polished visuals, zero hook. The content gets likes, but nobody saves it, shares it, or buys from it. You look professional and stay invisible.</p>
              </div>
              <div className="diagnostic fade-up d1">
                <div className="diag-head">
                  <span className="diag-id">ERR_02</span>
                  <span className="diag-status">NO SYSTEM</span>
                </div>
                <h3>Random content, <span className="blue">random results.</span></h3>
                <p>A shoot here, a post there, a freelancer somewhere in between. No editorial voice. No visual consistency. Nothing compounds, so nothing grows.</p>
              </div>
              <div className="diagnostic fade-up d2">
                <div className="diag-head">
                  <span className="diag-id">ERR_03</span>
                  <span className="diag-status">COPY GAP</span>
                </div>
                <h3>Great footage. <span className="blue">Dead captions.</span></h3>
                <p>Visuals sharp, words generic. Copy gets tacked on last. Nobody who shot it wrote it. Nobody who wrote it knows the strategy.</p>
              </div>
            </div>
          </div>
        </section>

        {/* THESIS */}
        <section className="thesis">
          <div className="container">
            <div className="thesis-grid">
              <div className="thesis-sidebar">
                // THESIS.03
                <div className="meta">
                  ID: CRAFT_OVER_VOLUME<br />
                  VER: 1.0<br />
                  BY: MD Media
                </div>
              </div>
              <div className="thesis-body">
                <h2>Content is a craft. <span className="blue">Most people treat it like a task.</span></h2>
                <p>
                  Anyone can fill a feed. Fewer people can produce content that moves a business metric.
                  The difference isn&apos;t equipment, budget, or aesthetic. <strong>It&apos;s intent.</strong>
                </p>
                <p>
                  Every frame we shoot is built against a purpose. Every script is written against a sale.
                  Every edit is cut against a conversion pattern we&apos;ve tested on other accounts. Nothing is
                  produced just to exist.
                </p>
                <p>
                  That&apos;s the difference between a feed that looks busy and a feed that earns its keep.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CAPABILITIES */}
        <section>
          <div className="container">
            <h2 className="section-title">
              One studio, <span className="blue">every asset.</span>
            </h2>
            <p className="section-lede">
              Photography, video, copy, design, motion. Everything produced by the same in-house team.{' '}
              <strong>You brief once, not six times.</strong>
            </p>

            <div className="system-grid">
              <div className="sys-cell fade-up">
                <div className="sys-id"><span className="dot"></span>MOD_01 / PHOTO</div>
                <h3>Brand &amp; campaign photography</h3>
                <p>Editorial portraits, product, lifestyle, behind-the-scenes. Shot by a crew that gets your aesthetic from the first slate.</p>
              </div>
              <div className="sys-cell fade-up d1">
                <div className="sys-id"><span className="dot"></span>MOD_02 / VIDEO</div>
                <h3>Short-form &amp; social video</h3>
                <p>Reels, TikTok, YouTube Shorts. Hook-driven, retention-focused, cut to platform-specific rhythms. Not generic 9:16 exports.</p>
              </div>
              <div className="sys-cell fade-up d2">
                <div className="sys-id"><span className="dot"></span>MOD_03 / LONG-FORM</div>
                <h3>Podcasts &amp; long-form</h3>
                <p>YouTube videos, interview series, podcast production. End-to-end from booking to publish, including our Melbourne studio.</p>
              </div>
              <div className="sys-cell fade-up d3">
                <div className="sys-id"><span className="dot"></span>MOD_04 / ADS</div>
                <h3>Paid ad creative</h3>
                <p>Creative built for Meta, Google, TikTok. Hooks engineered for thumb-stop, cuts engineered for conversion. Tested, iterated.</p>
              </div>
              <div className="sys-cell fade-up">
                <div className="sys-id"><span className="dot"></span>MOD_05 / COPY</div>
                <h3>Scripts, hooks &amp; captions</h3>
                <p>Written by people who&apos;ve read the reporting. Copy that matches the shoot, matches the strategy, earns its click.</p>
              </div>
              <div className="sys-cell fade-up d1">
                <div className="sys-id"><span className="dot"></span>MOD_06 / DESIGN</div>
                <h3>Graphic design &amp; layout</h3>
                <p>Post designs, carousels, landing page visuals, pitch decks, EDMs. On-brand by default, shipped without the back-and-forth.</p>
              </div>
              <div className="sys-cell fade-up d2">
                <div className="sys-id"><span className="dot"></span>MOD_07 / MOTION</div>
                <h3>Motion &amp; animation</h3>
                <p>Animated explainers, logo motion, text overlays, transitions. Built to match your brand system, not to look like anyone else&apos;s.</p>
              </div>
              <div className="sys-cell fade-up d3">
                <div className="sys-id"><span className="dot"></span>MOD_08 / UGC</div>
                <h3>UGC &amp; creator content</h3>
                <p>Creator-led content built for paid ads. Scripting, casting, direction, delivery. Performance of UGC, reliability of a studio.</p>
              </div>
            </div>
          </div>
        </section>

        {/* GALLERY */}
        <section className="gallery-section" aria-label="Selected work">
          <div className="gallery-head">
            <span className="left">&middot; SELECTED WORK / 08 FRAMES</span>
            <span>MDM_STUDIO / 2024 &ndash; 2026</span>
          </div>
          <div className="gallery-grid">
            {[
              'c5a69a_ee1b3ff7d02f49d48e861525a53f854e~mv2.jpg',
              'c5a69a_d9b7c76f5ef24425831a0a028267fa48~mv2.jpg',
              'c5a69a_f43a41c30b844b9ea6e5b277402c0d20~mv2.jpg',
              'c5a69a_613d011236db474e8598f904efd901cf~mv2.jpg',
              'c5a69a_92e33aa145994dbf85c3be0a2bf40744~mv2.jpg',
              'c5a69a_cb2b1317681a4591ab979c4db9750afb~mv2.jpg',
              'c5a69a_84cad2c9b8f3483499ce267cd135010b~mv2.jpg',
              'c5a69a_eb0247d4e72e4979834b6a8ef6b5c303~mv2.jpg',
            ].map((img, i) => (
              <div key={img} className="gallery-item">
                <img
                  src={`https://static.wixstatic.com/media/${img}`}
                  alt="MD Media content production"
                  loading="lazy"
                />
                <span className={`gallery-cap${i % 3 === 1 ? ' blue' : ''}`}>FRM_0{i + 1}</span>
              </div>
            ))}
          </div>
        </section>

        {/* MODELS */}
        <section id="models">
          <div className="container">
            <h2 className="section-title">
              Two ways <span className="blue">to work.</span>
            </h2>
            <p className="section-lede">
              Subscription for always-on output. Project for one big thing.{' '}
              <strong>Most businesses run both.</strong>
            </p>

            <div className="models-grid">
              <div className="model fade-up">
                <div className="model-meta">
                  <span className="model-id">MODEL_01</span>
                  <span className="model-type">Recurring</span>
                </div>
                <h3>Content <span className="blue">Subscription</span></h3>
                <div className="model-desc">
                  Monthly production, monthly delivery.{' '}
                  <strong>Your always-on content engine.</strong> One shoot per month becomes dozens of assets across every channel.
                </div>
                <ul>
                  <li>Half-day or full-day monthly shoot</li>
                  <li>Photography + video + copy</li>
                  <li>Editing, colour, sound, motion</li>
                  <li>Cross-platform asset variants</li>
                  <li>Scripts, captions, hooks included</li>
                  <li>Same pod every month</li>
                  <li>Monthly review &amp; brief refresh</li>
                </ul>
                <div className="model-footer">Min. 3 months &middot; Scope to business</div>
              </div>
              <div className="model dark fade-up d1">
                <div className="model-meta">
                  <span className="model-id">MODEL_02</span>
                  <span className="model-type">One-Off</span>
                </div>
                <h3>Project <span className="blue">Production</span></h3>
                <div className="model-desc">
                  Campaigns, launches, brand films, events, big productions.{' '}
                  <strong>One big thing, done right.</strong> Scoped, quoted, and delivered against a fixed brief.
                </div>
                <ul>
                  <li>Full pre-production planning</li>
                  <li>Multi-day shoots when required</li>
                  <li>Location scouting &amp; logistics</li>
                  <li>Talent casting &amp; direction</li>
                  <li>Full post, colour, audio, delivery</li>
                  <li>Campaign rollout assets included</li>
                  <li>Paid media cuts on request</li>
                </ul>
                <div className="model-footer">Fixed scope &middot; Quoted per project</div>
              </div>
            </div>
          </div>
        </section>

        {/* PROCESS TIMELINE */}
        <section>
          <div className="container">
            <h2 className="section-title">
              From brief to <span className="blue">broadcast in 21 days.</span>
            </h2>
            <p className="section-lede">
              Every shoot follows the same runsheet. No guesswork, no scope creep, no &quot;what are we doing again?&quot; in the group chat.
            </p>

            <div className="timeline">
              <div className="timeline-row fade-up">
                <span className="t-num">DAY_01 &middot; 03</span>
                <span className="t-name">Pre-production</span>
                <span className="t-desc">Brief confirmed. Shot list built. Scripts written. Talent confirmed, locations locked, crew called. You approve before anyone unpacks a camera.</span>
                <span className="t-time">72 hrs</span>
              </div>
              <div className="timeline-row fade-up d1">
                <span className="t-num">DAY_04 &middot; 05</span>
                <span className="t-name">Shoot day</span>
                <span className="t-desc">Full production day (or half). Camera, lighting, sound, direction. You show up, we run the rest. Live monitor for approval on key frames.</span>
                <span className="t-time">1 to 2 days</span>
              </div>
              <div className="timeline-row fade-up d2">
                <span className="t-num">DAY_06 &middot; 14</span>
                <span className="t-name">Post-production</span>
                <span className="t-desc">Editing, colour, audio, motion. Copy written against the footage, not before it. First cuts delivered for review, revisions built into the timeline.</span>
                <span className="t-time">5 to 8 days</span>
              </div>
              <div className="timeline-row fade-up d3">
                <span className="t-num">DAY_15 &middot; 21</span>
                <span className="t-name">Delivery &amp; publish</span>
                <span className="t-desc">Final assets delivered in all required formats. Scheduled, published, or handed off clean. Subscription clients get rolling delivery, not one big dump.</span>
                <span className="t-time">Ongoing</span>
              </div>
            </div>
          </div>
        </section>

        {/* FIT CHECK */}
        <section>
          <div className="container">
            <h2 className="section-title">
              Right brief, <span className="blue">right crew.</span>
            </h2>

            <div className="filter-grid">
              <div className="filter-col yes">
                <h3>
                  <span>Ready for this, if</span>
                  <span className="status">● FIT</span>
                </h3>
                <ul className="filter-list">
                  <li>You want content that converts, not content that fills a calendar</li>
                  <li>You value one crew over three freelancers</li>
                  <li>You&apos;ll show up to shoots with energy, not just a brief</li>
                  <li>You see production as a long-term investment</li>
                  <li>You want photo, video, and copy in one engine</li>
                </ul>
              </div>
              <div className="filter-col no">
                <h3>
                  <span>Not a fit, if</span>
                  <span className="status">○ SKIP</span>
                </h3>
                <ul className="filter-list">
                  <li>You want the cheapest rate on Gumtree</li>
                  <li>You want raw files to edit yourself</li>
                  <li>You want content produced without strategy</li>
                  <li>You expect overnight turnarounds every month</li>
                  <li>You see production as a commodity, not a craft</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ABOUT */}
        <section>
          <div className="container">
            <h2 className="section-title">
              Built from <span className="blue">the lens.</span>
            </h2>

            <div className="about-grid">
              <div className="about-image">
                <img
                  src="https://static.wixstatic.com/media/c5a69a_e14751cecceb4b1591d395ec8f2ea5dc~mv2.jpg"
                  alt="Divina Armuela and Martin Kormushoski, co-founders of MD Media Marketing"
                  loading="lazy"
                />
                <div className="about-image-cap">
                  <span>PORTRAIT.03</span>
                  <span className="blue">MDM_CREW</span>
                </div>
              </div>
              <div className="about-text">
                <p>
                  Most content agencies are run by account managers. We&apos;re run by people who&apos;ve been in the room, on the shoot, behind the monitor. Martin built his eye through production and post. Divina through content creation and psychographics.{' '}
                  <strong>Every decision here is made by someone who&apos;s actually made content before.</strong>
                </p>
                <p>
                  Our team of 15 runs on a pod model. Same strategist, same producer, same editor, every shoot. No rotating freelancers, no quality drift between months, no &quot;who worked on this one?&quot; moments. You build a relationship with the people making your content, not the account manager between you.
                </p>
                <p>
                  Today we produce content for 17 active retainers and run project productions across finance, hospitality, real estate, health, automotive, and personal brands. The best content comes from understanding the business, not just the brief.
                </p>
                <span className="founders-sig">
                  Divina Armuela <span className="divide">//</span> Martin Kormushoski
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section>
          <div className="container">
            <h2 className="section-title">
              Questions you&apos;re <span className="blue">actually asking.</span>
            </h2>
            <FaqList />
          </div>
        </section>

        {/* APPLY / BOOK */}
        <section className="apply" id="apply">
          <div className="container">
            <h2 className="section-title">
              Let&apos;s build something <span className="blue">worth watching.</span>
            </h2>
            <p className="section-lede">
              Limited monthly intake. Three new subscriptions and two big projects booked per month. Tell us what you need produced and we&apos;ll be in touch.
            </p>
            <ContactForm />
          </div>
        </section>

      </main>

      {/* FOOTER */}
      <footer>
        <div className="container">
          <div className="footer-top">
            <div>
              <a href="/" className="footer-mast" aria-label="MD Media Marketing home">
                <img src="https://static.wixstatic.com/media/c5a69a_eb5dd45dbca445798fa310acb86c4420~mv2.png" alt="MD Media Marketing" />
              </a>
              <div className="footer-tagline">
                Photo. Video. Copy.<br />Produced in-house for businesses that want content worth watching.
              </div>
            </div>
            <div className="footer-col">
              <h4>&raquo; Services</h4>
              <a href="/content">Content Production</a>
              <a href="https://personalbrand.mdmmarketing.com.au/" target="_blank" rel="noreferrer noopener">Personal Brand</a>
              <a href="https://brand.mdmmarketing.com.au/" target="_blank" rel="noreferrer noopener">Brand &amp; Strategy</a>
              <a href="https://marketing.mdmmarketing.com.au/" target="_blank" rel="noreferrer noopener">Ongoing Marketing</a>
              <a href="https://scorecard.mdmmarketing.com.au/" target="_blank" rel="noreferrer noopener">Free Diagnostic</a>
            </div>
            <div className="footer-col">
              <h4>&raquo; Contact</h4>
              <a href="mailto:hello@mdmmarketing.com.au">hello@mdmmarketing.com.au</a>
              <a href="tel:+61447764477">0447 764 477</a>
              <a href="/">Main site</a>
            </div>
            <div className="footer-col">
              <h4>&raquo; Connect</h4>
              <a href="https://www.instagram.com/mdmedia._" target="_blank" rel="noreferrer noopener">Instagram</a>
              <a href="https://www.linkedin.com/company/mdmedia-marketing/" target="_blank" rel="noreferrer noopener">LinkedIn</a>
              <a href="https://www.tiktok.com/@mdmedia._" target="_blank" rel="noreferrer noopener">TikTok</a>
              <a href="https://youtube.com/@mdmediapodcast" target="_blank" rel="noreferrer noopener">YouTube</a>
            </div>
          </div>
          <div className="footer-bottom">
            <span>&copy; 2026 MD Media Marketing Pty Ltd &middot; ABN 75 681 730 512</span>
            <span>Vol. 03 // Content Production</span>
          </div>
        </div>
      </footer>

      <ScrollObserver />
    </>
  )
}
