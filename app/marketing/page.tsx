import MarketingForm from '../components/MarketingForm'
import FaqList from '../components/FaqList'
import ScrollObserver from '../components/ScrollObserver'

export default function MarketingPage() {
  return (
    <>
      <main>

        {/* HERO */}
        <section className="hero">
          <div className="hero-bg">
            <img
              src="https://static.wixstatic.com/media/c5a69a_301debe79d924d1485598c4f5f601013~mv2.jpg/v1/fill/w_1920,h_1080,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/c5a69a_301debe79d924d1485598c4f5f601013~mv2.jpg"
              alt=""
              aria-hidden="true"
            />
            <div className="hero-overlay" />
          </div>
          <div className="container hero-inner">
            <p className="hero-tagline">Ongoing Marketing &amp; Content Systems</p>
            <h1 className="hero-h1">
              Consistent marketing,<br />
              without{' '}
              <span className="hero-strike">the full-time</span><br />
              <span style={{ color: 'var(--blue)' }}>the full-time</span> hire.
            </h1>
            <p className="hero-desc">
              Agencies deliver posts. <strong style={{ color: 'var(--bg)' }}>We deliver a system.</strong>{' '}
              Content, campaigns, and reporting — handled by a pod of specialists who already work together.
            </p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '36px', flexWrap: 'wrap' }}>
              <a href="#apply" className="btn">Start a retainer <span className="arr">→</span></a>
              <a href="https://scorecard.mdmmarketing.com.au" className="btn btn-outline" target="_blank" rel="noreferrer noopener">Run diagnostic <span className="arr">→</span></a>
            </div>
          </div>
        </section>

        {/* STATS STRIP */}
        <div className="stats-strip">
          <div className="container stats-inner">
            <div className="stat-item">
              <span className="stat-val">17</span>
              <span className="stat-label">Active retainers</span>
            </div>
            <div className="stat-div" />
            <div className="stat-item">
              <span className="stat-val">15</span>
              <span className="stat-label">In-house team</span>
            </div>
            <div className="stat-div" />
            <div className="stat-item">
              <span className="stat-val">6</span>
              <span className="stat-label">Industries</span>
            </div>
            <div className="stat-div" />
            <div className="stat-item">
              <span className="stat-val blue">12+ mo</span>
              <span className="stat-label">Avg engagement</span>
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
              POSTING ≠ MARKETING <span className="marquee-dot">●</span> BUILT TO RUN{' '}
              <span className="marquee-dot">●</span> STRATEGY · PRODUCTION · DISTRIBUTION{' '}
              <span className="marquee-dot">●</span> CONSISTENCY IS THE STRATEGY{' '}
              <span className="marquee-dot">●</span> NO HANDOFFS <span className="marquee-dot">●</span>
            </span>
            <span className="marquee-item">
              POSTING ≠ MARKETING <span className="marquee-dot">●</span> BUILT TO RUN{' '}
              <span className="marquee-dot">●</span> STRATEGY · PRODUCTION · DISTRIBUTION{' '}
              <span className="marquee-dot">●</span> CONSISTENCY IS THE STRATEGY{' '}
              <span className="marquee-dot">●</span> NO HANDOFFS <span className="marquee-dot">●</span>
            </span>
          </div>
        </div>

        {/* PROBLEM */}
        <section>
          <div className="container">
            <h2 className="section-title">
              Most businesses don&apos;t have a marketing problem. They have a <span className="blue">consistency</span> problem.
            </h2>
            <p className="section-lede">
              You know what you should be doing. You just can&apos;t do it every week, on every channel, while also running the business. That&apos;s not a strategy gap. That&apos;s <strong>an operations gap</strong>.
            </p>

            <div className="diagnostic-grid">
              <div className="diagnostic fade-up">
                <div className="diag-head">
                  <span className="diag-id">ERR_01</span>
                  <span className="diag-status">SOLO OPERATOR</span>
                </div>
                <h3>You&apos;re <span className="blue">the bottleneck</span> and you know it.</h3>
                <p>Every post, shoot, caption, ad, and reply runs through you. When you&apos;re busy with real work, marketing goes dark. When marketing goes dark, leads dry up. Cycle repeats.</p>
              </div>
              <div className="diagnostic fade-up d1">
                <div className="diag-head">
                  <span className="diag-id">ERR_02</span>
                  <span className="diag-status">NO OPERATOR</span>
                </div>
                <h3>Nobody owns <span className="blue">marketing</span> internally.</h3>
                <p>You don&apos;t have a full-time marketer, and you can&apos;t justify one yet. So marketing becomes everybody&apos;s 10% and nobody&apos;s priority. The work happens reactively, not strategically.</p>
              </div>
              <div className="diagnostic fade-up d2">
                <div className="diag-head">
                  <span className="diag-id">ERR_03</span>
                  <span className="diag-status">WRONG OPERATOR</span>
                </div>
                <h3>The last agency <span className="blue">delivered posts,</span> not results.</h3>
                <p>You paid for a content calendar and got a content calendar. No strategy, no learning loops, no real accountability. You&apos;re once bitten and reasonably twice shy.</p>
              </div>
            </div>
          </div>
        </section>

        {/* THESIS */}
        <section className="thesis">
          <div className="container">
            <div className="thesis-grid">
              <div className="thesis-sidebar">
                // THESIS.02
                <div className="meta">
                  ID: MKT_AS_INFRASTRUCTURE<br />
                  VER: 1.0<br />
                  BY: MD Media
                </div>
              </div>
              <div className="thesis-body">
                <h2>Marketing isn&apos;t a project. <span className="blue">It&apos;s a system.</span></h2>
                <p>Most businesses treat marketing like a launch. They push hard, hit a quiet week, and the whole thing stalls. Then a quarter later, they start again.</p>
                <p>A real marketing system doesn&apos;t care about quiet weeks. It runs on its own cadence, with its own checkpoints, producing output whether you&apos;re in the room or not. <strong>That&apos;s what we build.</strong></p>
                <p>The difference isn&apos;t more content. It&apos;s a team that already knows what to ship, when to ship it, and how to measure whether it worked. You stop managing marketing. You start reviewing it.</p>
              </div>
            </div>
          </div>
        </section>

        {/* SYSTEM — WHAT RUNS */}
        <section>
          <div className="container">
            <h2 className="section-title">Every module, <span className="blue">handled in-house.</span></h2>
            <p className="section-lede">
              No subcontractors, no outsourced editors, no lost-in-translation moments. Your pod owns the whole stack, from strategy to the final frame.
            </p>

            <div className="system-grid">
              <div className="sys-cell fade-up">
                <div className="sys-id"><span className="dot"></span>MOD_01 / STRATEGY</div>
                <h3>Quarterly strategy &amp; content pillars</h3>
                <p>Direction set in advance. Every piece of content maps to a business outcome, not a posting schedule.</p>
              </div>
              <div className="sys-cell fade-up d1">
                <div className="sys-id"><span className="dot"></span>MOD_02 / PRODUCTION</div>
                <h3>Monthly shoots &amp; editing</h3>
                <p>Professional video, photo, and graphics produced in-house. One shoot feeds multiple weeks across every channel.</p>
              </div>
              <div className="sys-cell fade-up d2">
                <div className="sys-id"><span className="dot"></span>MOD_03 / SOCIAL</div>
                <h3>Platform management</h3>
                <p>Instagram, TikTok, LinkedIn, YouTube. Posting, captions, engagement, community. All tracked and optimised.</p>
              </div>
              <div className="sys-cell fade-up d3">
                <div className="sys-id"><span className="dot"></span>MOD_04 / PAID ADS</div>
                <h3>Meta &amp; Google campaigns</h3>
                <p>Your best-performing organic content becomes paid. Retargeting, lead gen, and conversion campaigns built and managed.</p>
              </div>
              <div className="sys-cell fade-up">
                <div className="sys-id"><span className="dot"></span>MOD_05 / EMAIL</div>
                <h3>EDM &amp; nurture sequences</h3>
                <p>Newsletters, welcome flows, sales sequences. Email that actually earns its open rate.</p>
              </div>
              <div className="sys-cell fade-up d1">
                <div className="sys-id"><span className="dot"></span>MOD_06 / COPY</div>
                <h3>Captions, scripts, hooks</h3>
                <p>Written by people who&apos;ve sat in the shoots and read the reporting. Copy that matches the strategy, not generic fill.</p>
              </div>
              <div className="sys-cell fade-up d2">
                <div className="sys-id"><span className="dot"></span>MOD_07 / REPORTING</div>
                <h3>Monthly performance review</h3>
                <p>What worked, what didn&apos;t, what we&apos;re testing next. You see the data, not just the deliverables.</p>
              </div>
              <div className="sys-cell fade-up d3">
                <div className="sys-id"><span className="dot"></span>MOD_08 / ACCOUNT</div>
                <h3>Dedicated account lead</h3>
                <p>One point of contact, same face every week. They know your business, your brand, and your tone.</p>
              </div>
            </div>
          </div>
        </section>

        {/* TIERS */}
        <section>
          <div className="container">
            <h2 className="section-title">Four tiers. <span className="blue">One engine.</span></h2>
            <p className="section-lede">
              Same strategic approach, same production quality, same team. The difference between tiers is cadence, channels, and how aggressive we go on paid.{' '}
              <strong>Scope to the business, not the other way around.</strong>
            </p>

            <div className="tiers-grid">
              <div className="tier fade-up">
                <div className="tier-meta">
                  <span className="tier-id">TIER_01</span>
                </div>
                <h3>Starter</h3>
                <div className="tier-for">First real content presence. Consistent and on-brand from day one.</div>
                <ul>
                  <li>Brand strategy session</li>
                  <li>4 reels + 4 graphics / mo</li>
                  <li>1 to 2 platform mgmt</li>
                  <li>Monthly strategy check-in</li>
                  <li>Content calendar</li>
                </ul>
                <div className="tier-footer">Min. 3 months</div>
              </div>
              <div className="tier featured fade-up d1">
                <div className="tier-meta">
                  <span className="tier-id">TIER_02</span>
                  <span className="tier-badge">Most Chosen</span>
                </div>
                <h3>Growth</h3>
                <div className="tier-for">Cross-platform presence with ads that actually convert.</div>
                <ul>
                  <li>8 reels + 8 graphics / mo</li>
                  <li>Half-day content shoot</li>
                  <li>2 to 3 platform mgmt</li>
                  <li>Meta ads (1 campaign)</li>
                  <li>Monthly strategy call</li>
                  <li>Performance reporting</li>
                </ul>
                <div className="tier-footer">Min. 3 months</div>
              </div>
              <div className="tier fade-up d2">
                <div className="tier-meta">
                  <span className="tier-id">TIER_03</span>
                </div>
                <h3>Scale</h3>
                <div className="tier-for">Full-stack content &amp; performance. Dominate your space.</div>
                <ul>
                  <li>12 to 16 reels / mo</li>
                  <li>Full-day production</li>
                  <li>All platforms managed</li>
                  <li>Meta ads (3 campaigns)</li>
                  <li>Weekly reporting</li>
                  <li>EDM / email marketing</li>
                </ul>
                <div className="tier-footer">Min. 3 months</div>
              </div>
              <div className="tier fade-up d3">
                <div className="tier-meta">
                  <span className="tier-id">TIER_04</span>
                </div>
                <h3>Premium</h3>
                <div className="tier-for">High-volume, multi-brand ecosystem. Full-funnel everything.</div>
                <ul>
                  <li>14 to 20+ reels / mo</li>
                  <li>YouTube production</li>
                  <li>Full ads management</li>
                  <li>EDM + blog + SEO</li>
                  <li>Dedicated account mgr</li>
                  <li>Weekly strategy</li>
                </ul>
                <div className="tier-footer">Min. 6 months</div>
              </div>
            </div>
          </div>
        </section>

        {/* ONBOARDING TIMELINE */}
        <section>
          <div className="container">
            <h2 className="section-title">From zero to <span className="blue">running system.</span></h2>
            <p className="section-lede">
              Every engagement starts the same way. Foundation, then production, then optimisation. Month by month, with clear checkpoints.
            </p>

            <div className="timeline">
              <div className="timeline-row fade-up">
                <span className="t-num">WEEK_01 &middot; 02</span>
                <span className="t-name">Foundation</span>
                <span className="t-desc">Strategy session, brand deep-dive, content pillars, and 90-day roadmap. Access to analytics, platforms, and past performance data.</span>
                <span className="t-time">Month 01</span>
              </div>
              <div className="timeline-row fade-up d1">
                <span className="t-num">WEEK_03 &middot; 04</span>
                <span className="t-name">First Production</span>
                <span className="t-desc">First content shoot, scripts locked, visual direction confirmed. Platforms audited and set up. Content calendar pre-loaded.</span>
                <span className="t-time">Month 01</span>
              </div>
              <div className="timeline-row fade-up d2">
                <span className="t-num">WEEK_05 &middot; 08</span>
                <span className="t-name">Content Live</span>
                <span className="t-desc">Content goes live across all contracted channels. Community management active. First round of learnings feeds back into strategy.</span>
                <span className="t-time">Month 02</span>
              </div>
              <div className="timeline-row fade-up d3">
                <span className="t-num">WEEK_09 &middot; 12</span>
                <span className="t-name">Data to Scale</span>
                <span className="t-desc">First full reporting cycle. We show you what&apos;s working, what&apos;s not, and what the next 90 days look like. Ads dialled in, not guessed.</span>
                <span className="t-time">Month 03</span>
              </div>
            </div>
          </div>
        </section>

        {/* FIT CHECK */}
        <section>
          <div className="container">
            <h2 className="section-title">Right system, <span className="blue">right business.</span></h2>

            <div className="filter-grid">
              <div className="filter-col yes">
                <h3><span>Ready for this, if</span><span className="status">● FIT</span></h3>
                <ul className="filter-list">
                  <li>You&apos;re past the &ldquo;figure it out ourselves&rdquo; phase</li>
                  <li>You want one team, not three freelancers</li>
                  <li>You want strategy, production, and ads in one engine</li>
                  <li>You&apos;ve been burned and want process, not personality</li>
                  <li>You treat marketing as an investment, not an expense</li>
                </ul>
              </div>
              <div className="filter-col no">
                <h3><span>Not a fit, if</span><span className="status">○ SKIP</span></h3>
                <ul className="filter-list">
                  <li>You want someone to just post for you</li>
                  <li>You want a month-to-month trial with no commitment</li>
                  <li>You expect viral results in week one</li>
                  <li>You want the cheapest option in the market</li>
                  <li>You aren&apos;t willing to show up for shoots and calls</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ABOUT */}
        <section>
          <div className="container">
            <h2 className="section-title">Run by operators. <span className="blue">Not just marketers.</span></h2>

            <div className="about-grid">
              <div className="about-image">
                <img
                  src="https://static.wixstatic.com/media/c5a69a_e14751cecceb4b1591d395ec8f2ea5dc~mv2.jpg"
                  alt="Divina Armuela and Martin Kormushoski, co-founders of MD Media Marketing"
                  loading="lazy"
                />
                <div className="about-image-cap">
                  <span>PORTRAIT.02</span>
                  <span className="blue">MDM_CO-FOUNDERS</span>
                </div>
              </div>
              <div className="about-text">
                <p>
                  Most agencies are built by marketers. We&apos;re not. Divina and Martin come from the other side of the business — one from content and psychographics, one from production and design. They started MD Media because they kept seeing the same pattern: businesses spending on marketing that never built anything.
                </p>
                <p>
                  The team of 15 they&apos;ve built since runs on the same principle. <strong>Everyone in-house, every discipline represented, every client on a pod model.</strong> You work with the same five people every month. Strategist, producer, editor, account lead, and reporting analyst. No rotating freelancers.
                </p>
                <p>
                  Today MD Media runs ongoing marketing for 17 active retainers across finance, hospitality, real estate, health, automotive, construction, and personal brands. Most clients stay 12+ months. The ones who leave usually outgrow the tier, not the team.
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
            <h2 className="section-title">Questions you&apos;re <span className="blue">actually thinking.</span></h2>
            <FaqList />
          </div>
        </section>

        {/* APPLY */}
        <section className="apply" id="apply">
          <div className="container">
            <h2 className="section-title">
              Stop starting over every Monday. <span className="blue">Hand it over.</span>
            </h2>
            <p className="section-lede">
              Limited monthly intake. Three new retainers onboarded per month so every pod gets real attention. Tell us about your business and we&apos;ll be in touch.
            </p>
            <MarketingForm />
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
                Strategy. Production. Distribution.<br />
                Built in-house for businesses that can&apos;t afford to go quiet.
              </div>
            </div>
            <div className="footer-col">
              <h4>&raquo; Services</h4>
              <a href="/content">Content Production</a>
              <a href="https://personalbrand.mdmmarketing.com.au/" target="_blank" rel="noreferrer noopener">Personal Brand</a>
              <a href="https://brand.mdmmarketing.com.au/" target="_blank" rel="noreferrer noopener">Brand &amp; Strategy</a>
              <a href="/marketing">Ongoing Marketing</a>
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
            <span>Vol. 02 // Ongoing Marketing</span>
          </div>
        </div>
      </footer>

      <ScrollObserver />
    </>
  )
}
