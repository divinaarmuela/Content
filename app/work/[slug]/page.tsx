import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { archivo, sometype } from '../../components/lama/fonts'
import { Scramble } from '../../components/lama/Scramble'
import LamaNav from '../../components/lama/LamaNav'
import LamaFooter from '../../components/lama/LamaFooter'
import ScrollObserver from '../../components/ScrollObserver'
import SiteMedia from '../../components/SiteMedia'
import { clients } from '../../components/lama/workData'
import { getSiteProject, getSiteProjects } from '../../lib/websiteData'

const CALENDLY = 'https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone'

// case pages refresh from the CMS at most every 5 minutes; slugs added via
// the dashboard render on demand (dynamicParams defaults to true)
export const revalidate = 300

export function generateStaticParams() {
  return clients.map(c => ({ slug: c.slug }))
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

function Block({ label, paragraphs }: { label: string; paragraphs: string[] }) {
  if (!paragraphs.length) return null
  return (
    <section className="border-t border-cream/15 px-6 sm:px-10 py-14 sm:py-20">
      <div className="mx-auto max-w-5xl grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <Scramble text={`[ ${label} ]`} gate={false} className="font-lamam text-[11px] uppercase tracking-widest text-cream-dim self-start" />
        <div className="flex flex-col gap-5">
          {paragraphs.map((p, i) => (
            <p key={i} className="font-lamah text-cream/85 text-[clamp(1rem,1.5vw,1.2rem)] leading-[1.7] m-0 max-w-[62ch]">
              {p}
            </p>
          ))}
        </div>
      </div>
    </section>
  )
}

export default async function CaseStudyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const [project, all] = await Promise.all([getSiteProject(slug), getSiteProjects()])
  if (!project) notFound()

  const index = all.findIndex(p => p.slug === project.slug)
  const next = all[(index + 1) % all.length]

  return (
    <div className={`${archivo.variable} ${sometype.variable} bg-ink min-h-screen`}>
      <LamaNav gate={false} />
      <main>
        {/* HERO */}
        <header className="px-6 sm:px-10 pt-28 sm:pt-36 pb-10">
          <div className="mx-auto max-w-5xl">
            <a href="/work" className="font-lamam text-[11px] uppercase tracking-widest text-cream-dim no-underline hover:text-cream transition-colors">
              ← All work
            </a>
            <div className="mt-10">
              <Scramble
                text={`· ${project.tag} · ${project.industry}`}
                gate={false}
                className="font-lamam text-[11px] uppercase tracking-widest text-cream-faint"
              />
            </div>
            <h1 className="font-lamah font-medium text-cream text-[clamp(2.4rem,6vw,4.5rem)] leading-[0.98] tracking-[-0.03em] mt-4 mb-5">
              {project.name}
            </h1>
            <p className="font-lamah text-cream-dim text-[clamp(1.05rem,1.6vw,1.3rem)] leading-[1.6] max-w-[58ch] m-0">
              {project.desc}
            </p>

            <div className="mt-10 overflow-hidden">
              <SiteMedia
                src={project.heroMedia}
                alt={project.name}
                className="w-full aspect-[16/8] object-cover"
              />
            </div>

            {/* FACTS */}
            <div className="mt-px grid sm:grid-cols-3 gap-px bg-cream/15 border border-cream/15">
              {[
                ['Client', project.name],
                ['Industry', project.industry],
                ['Services', project.services.join(' · ')],
              ].map(([label, val]) => (
                <div key={label} className="bg-ink px-5 py-4">
                  <p className="font-lamam text-[10px] uppercase tracking-widest text-cream-faint m-0 mb-2">{label}</p>
                  <p className="font-lamah text-cream text-sm leading-relaxed m-0">{val}</p>
                </div>
              ))}
            </div>
          </div>
        </header>

        <Block label="The challenge" paragraphs={project.study.challenge} />
        <Block label="The approach" paragraphs={project.study.approach} />
        <Block label="The outcome" paragraphs={project.study.outcome} />

        {/* RESULT */}
        {project.result && (
          <section className="border-t border-cream/15 px-6 sm:px-10 py-14">
            <div className="mx-auto max-w-5xl flex flex-wrap items-baseline gap-x-8 gap-y-2">
              <span className="font-lamah font-medium text-accent text-[clamp(2rem,4.5vw,3.4rem)] tracking-[-0.02em]">
                {project.result}
              </span>
              <Scramble text="[ HEADLINE RESULT ]" gate={false} className="font-lamam text-[11px] uppercase tracking-widest text-cream-dim" />
            </div>
          </section>
        )}

        {/* NEXT + CTA */}
        <section className="border-t border-cream/15 px-6 sm:px-10 py-16 sm:py-24">
          <div className="mx-auto max-w-5xl">
            <p className="font-lamam text-[11px] uppercase tracking-widest text-cream-faint m-0 mb-4">Next case study</p>
            <a href={`/work/${next.slug}`} className="group inline-block no-underline">
              <span className="font-lamah font-medium uppercase text-cream text-[clamp(1.8rem,5vw,3.2rem)] leading-[1] tracking-tight group-hover:text-accent transition-colors">
                {next.name} →
              </span>
            </a>

            <div className="mt-16 flex flex-wrap gap-4">
              <a
                href={CALENDLY}
                target="_blank"
                rel="noreferrer noopener"
                className="border border-cream/25 px-6 py-4 font-lamam text-xs uppercase tracking-widest text-cream visited:text-cream no-underline hover:bg-cream hover:text-ink transition-colors"
              >
                BOOK A STRATEGY CALL ↗
              </a>
              <a
                href="/work"
                className="border border-cream/10 px-6 py-4 font-lamam text-xs uppercase tracking-widest text-cream-dim visited:text-cream-dim no-underline hover:border-cream/25 hover:text-cream transition-colors"
              >
                ALL WORK
              </a>
            </div>
          </div>
        </section>
      </main>
      <LamaFooter vol={`Case study · ${project.name}`} />
      <ScrollObserver />
    </div>
  )
}
