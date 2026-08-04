import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { archivo, sometype } from '../../components/lama/fonts'
import { Scramble } from '../../components/lama/Scramble'
import Reveal from '../../components/lama/Reveal'
import LamaNav from '../../components/lama/LamaNav'
import LamaFooter from '../../components/lama/LamaFooter'
import ScrollObserver from '../../components/ScrollObserver'
import SiteMedia from '../../components/SiteMedia'
import { clients } from '../../components/lama/workData'
import { getSiteProject, getSiteProjects } from '../../lib/websiteData'
import { isVideoUrl } from '../../lib/media-core'

const CALENDLY = 'https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone'

// case pages refresh from the CMS at most every 5 minutes; slugs added via
// the dashboard render on demand (dynamicParams defaults to true)
export const revalidate = 300

/**
 * Prerender the slugs the CMS actually publishes.
 *
 * This used to return the hardcoded `clients` list, which meant a path was
 * built for every project whether or not it was published. Unpublishing one
 * then left a prerendered entry behind: the body correctly became Next's 404,
 * but it was served with HTTP 200 — a soft 404 that Google keeps indexed.
 *
 * Driving it from the published list means a hidden project has no prerendered
 * path at all, so it falls through to `notFound()` and answers a real 404.
 * dynamicParams defaults to true, so a project published later still renders
 * on demand.
 */
export async function generateStaticParams() {
  const projects = await getSiteProjects()
  return projects.length > 0
    ? projects.map(p => ({ slug: p.slug }))
    : clients.map(c => ({ slug: c.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const project = await getSiteProject(slug)
  if (!project) return {}
  return {
    title: `${project.name} — Case Study — MD Media Marketing`,
    description: project.desc,
    robots: 'index, follow',
    alternates: { canonical: `https://www.mdmmarketing.com.au/work/${project.slug}` },
    openGraph: {
      type: 'article',
      url: `https://www.mdmmarketing.com.au/work/${project.slug}`,
      title: `${project.name} — MD Media Case Study`,
      description: project.desc,
      siteName: 'MD Media Marketing',
      locale: 'en_AU',
    },
  }
}

/**
 * Gallery rhythm from the design pack: a pair of 4:5 portraits, then one 21:9
 * wide, repeating. Grouping in threes keeps that cadence for any number of
 * images — a lone trailing image renders wide rather than leaving a half-empty
 * row.
 */
function galleryRows(urls: string[]): { pair: string[]; wide?: string }[] {
  const rows: { pair: string[]; wide?: string }[] = []
  for (let i = 0; i < urls.length; i += 3) {
    const pair = urls.slice(i, i + 2)
    const wide = urls[i + 2]
    if (pair.length === 1 && !wide) rows.push({ pair: [], wide: pair[0] })
    else rows.push({ pair, wide })
  }
  return rows
}

/**
 * Case study in the static-pack design: hero, 16:9 cover, brief sidebar beside
 * the narrative, CMS gallery, numbered outcomes, next project.
 *
 * The pack also carries a client quote block. There is no quote field on
 * SiteProject and inventing one would put words in a client's mouth, so that
 * section is left out until the data exists rather than shipped with the
 * pack's "replace before publishing" placeholder.
 */
export default async function CaseStudyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const [project, all] = await Promise.all([getSiteProject(slug), getSiteProjects()])
  if (!project) notFound()

  const index = all.findIndex(p => p.slug === project.slug)
  const next = all[(index + 1) % all.length]

  const outcomes = project.study.outcome
  const rows = galleryRows(project.galleryUrls)

  return (
    <div className={`${archivo.variable} ${sometype.variable} bg-ink min-h-screen`}>
      <LamaNav gate={false} />
      <main>
        {/* ── HERO ── */}
        <header className="px-6 pb-10 pt-28 sm:px-10 sm:pt-36">
          <a
            href="/work"
            className="inline-flex items-center gap-2 font-lamam text-xs tracking-[0.04em] text-cream/50 no-underline transition-colors hover:text-cream"
          >
            ← all work
          </a>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <span className="rounded-full border border-cream/25 px-[15px] py-[7px] font-lamam text-[11px] uppercase tracking-[0.1em] text-cream">
              {project.tag}
            </span>
            <Scramble
              text={project.industry}
              gate={false}
              className="font-lamam text-[11px] uppercase tracking-[0.1em] text-cream/50"
            />
          </div>

          <h1 className="mt-6 max-w-[18ch] font-lamah font-medium text-cream leading-[0.98] tracking-[-0.04em] text-[clamp(2.4rem,7vw,5.6rem)]">
            <span className="block overflow-hidden">
              <Reveal gate={false}><span className="block pb-[0.08em]">{project.name}</span></Reveal>
            </span>
          </h1>

          <p className="mt-6 max-w-[52ch] font-lamah text-cream/65 text-[clamp(1.05rem,1.5vw,1.25rem)] leading-[1.55]">
            {project.desc}
          </p>
        </header>

        {/* ── HERO MEDIA ── */}
        <section className="px-6 pb-[clamp(60px,9vh,100px)] sm:px-10">
          <div className="relative overflow-hidden rounded-2xl">
            <SiteMedia
              src={project.heroMedia}
              alt={project.name}
              className="block aspect-[16/9] w-full bg-ink object-cover"
            />
            {isVideoUrl(project.heroMedia) && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full border border-cream/70 bg-ink/35 backdrop-blur-[3px] [animation:lama-play_2.6s_ease-in-out_infinite]">
                  <span className="ml-[5px] block h-0 w-0 border-y-[10px] border-l-[17px] border-y-transparent border-l-cream" />
                </div>
              </div>
            )}
            <span className="absolute bottom-3.5 left-4 font-lamam text-[10px] uppercase tracking-[0.12em] text-cream/75">
              {isVideoUrl(project.heroMedia) ? 'video' : 'image'}
            </span>
          </div>
        </section>

        {/* ── BRIEF / DETAILS ── */}
        <section className="px-6 pb-[clamp(70px,11vh,140px)] sm:px-10">
          <div className="grid items-start gap-[clamp(32px,5vw,90px)] lg:grid-cols-[0.65fr_1.35fr]">
            <div>
              <p className="font-lamam text-xs uppercase tracking-[0.14em] text-cream/40">the brief</p>
              <div className="mb-8 mt-5 h-px bg-cream/30" />
              <dl className="flex flex-col gap-[18px]">
                {[
                  ['client', project.name],
                  ['services', project.services.join(' · ')],
                  ['industry', project.industry],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="mb-1.5 font-lamam text-[11px] uppercase tracking-[0.1em] text-cream/40">
                      {label}
                    </dt>
                    <dd className="m-0 font-lamah text-base text-cream/80">{value}</dd>
                  </div>
                ))}
              </dl>

              {project.websiteUrl && (
                <a
                  href={project.websiteUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-8 inline-flex items-center gap-2 border border-cream/25 px-5 py-3 font-lamam text-[11px] uppercase tracking-[0.1em] text-cream no-underline transition-colors hover:bg-cream hover:text-ink"
                >
                  visit website ↗
                </a>
              )}
            </div>

            <div className="flex flex-col gap-[26px]">
              <h2 className="m-0 font-lamah font-medium text-cream leading-[1.18] tracking-[-0.025em] text-[clamp(1.5rem,3vw,2.4rem)] [text-wrap:balance]">
                <span className="block overflow-hidden">
                  <Reveal gate={false}><span className="block pb-[0.08em]">What the client needed,</span></Reveal>
                </span>
                <span className="block overflow-hidden">
                  <Reveal gate={false} delay={0.08}>
                    <span className="block pb-[0.08em] text-cream/50">and what we built.</span>
                  </Reveal>
                </span>
              </h2>

              {project.study.challenge.map((p, i) => (
                <p key={`c${i}`} className="m-0 font-lamah text-cream/70 text-[clamp(1.05rem,1.3vw,1.2rem)] leading-[1.6]">
                  {p}
                </p>
              ))}
              {project.study.approach.map((p, i) => (
                <p key={`a${i}`} className="m-0 font-lamah text-cream/55 text-[clamp(1.05rem,1.3vw,1.2rem)] leading-[1.6]">
                  {p}
                </p>
              ))}
            </div>
          </div>
        </section>

        {/* ── GALLERY ── */}
        {rows.length > 0 && (
          <section className="px-6 pb-[clamp(70px,11vh,140px)] sm:px-10">
            <div className="flex flex-col gap-[18px]">
              {rows.map((row, i) => (
                <div key={i} className="flex flex-col gap-[18px]">
                  {row.pair.length > 0 && (
                    <div className="grid gap-[18px] sm:grid-cols-2">
                      {row.pair.map(url => (
                        <SiteMedia
                          key={url}
                          src={url}
                          alt={`${project.name} — still`}
                          className="block aspect-[4/5] w-full rounded-[14px] bg-ink object-cover"
                        />
                      ))}
                    </div>
                  )}
                  {row.wide && (
                    <SiteMedia
                      src={row.wide}
                      alt={`${project.name} — still`}
                      className="block aspect-[21/9] w-full rounded-[14px] bg-ink object-cover"
                    />
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── OUTCOME ── */}
        {(outcomes.length > 0 || project.result) && (
          <section className="border-t border-cream/[0.16] bg-[#0E0E0E] px-6 py-[clamp(70px,11vh,140px)] sm:px-10">
            <div className="grid items-center gap-[clamp(36px,6vw,100px)] lg:grid-cols-[1.1fr_1fr]">
              <div>
                <p className="m-0 mb-6 font-lamam text-[11px] uppercase tracking-[0.14em] text-cream/40">
                  the result
                </p>
                {project.result && (
                  <p className="m-0 font-lamah font-medium text-accent leading-[1.1] tracking-[-0.02em] text-[clamp(2.2rem,5vw,3.6rem)]">
                    {project.result}
                  </p>
                )}
              </div>

              {outcomes.length > 0 && (
                <div className="flex flex-col">
                  <p className="m-0 mb-[18px] font-lamam text-[11px] uppercase tracking-[0.14em] text-cream/40">
                    what changed
                  </p>
                  {outcomes.map((line, i) => (
                    <div
                      key={i}
                      className="flex items-baseline gap-[18px] border-t border-cream/[0.14] py-6"
                    >
                      <span className="font-lamam text-xs text-accent">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <div className="font-lamah text-cream leading-[1.35] text-[clamp(1.05rem,1.5vw,1.3rem)]">
                        {line}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── NEXT + CTA ── */}
        <section className="border-t border-cream/15 px-6 py-16 sm:px-10 sm:py-24">
          <p className="m-0 mb-4 font-lamam text-[11px] uppercase tracking-widest text-cream/40">
            Next case study
          </p>
          <a href={`/work/${next.slug}`} className="group inline-block no-underline">
            <span className="font-lamah font-medium uppercase text-cream leading-[1] tracking-tight text-[clamp(1.8rem,5vw,3.2rem)] transition-colors group-hover:text-accent">
              {next.name} →
            </span>
          </a>

          <div className="mt-16 flex flex-wrap gap-4">
            <a
              href={CALENDLY}
              target="_blank"
              rel="noreferrer noopener"
              className="border border-cream/25 px-6 py-4 font-lamam text-xs uppercase tracking-widest text-cream no-underline transition-colors visited:text-cream hover:bg-cream hover:text-ink"
            >
              BOOK A STRATEGY CALL ↗
            </a>
            <a
              href="/work"
              className="border border-cream/10 px-6 py-4 font-lamam text-xs uppercase tracking-widest text-cream/60 no-underline transition-colors visited:text-cream/60 hover:border-cream/25 hover:text-cream"
            >
              ALL WORK
            </a>
          </div>
        </section>
      </main>
      <LamaFooter vol={`Case study · ${project.name}`} />
      <ScrollObserver />
    </div>
  )
}
