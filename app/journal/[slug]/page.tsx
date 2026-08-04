import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { archivo, sometype } from '../../components/lama/fonts'
import { Scramble } from '../../components/lama/Scramble'
import Reveal from '../../components/lama/Reveal'
import LamaNav from '../../components/lama/LamaNav'
import LamaFooter from '../../components/lama/LamaFooter'
import ScrollObserver from '../../components/ScrollObserver'
import SiteMedia from '../../components/SiteMedia'
import { articles } from '../journalData'
import { getJournalPost, getJournalPosts } from '../../lib/journalPosts'

const CALENDLY = 'https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone'

export const revalidate = 300

/** Prerender what the CMS publishes, falling back to the shipped articles if
 *  the table is empty — same posture as /work/[slug], so unpublishing a post
 *  leaves no prerendered path answering 200 with a 404 body. */
export async function generateStaticParams() {
  const posts = await getJournalPosts()
  return posts.length > 0
    ? posts.map(p => ({ slug: p.slug }))
    : articles.map(a => ({ slug: a.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const post = await getJournalPost(slug)
  if (!post) return {}
  return {
    title: `${post.title} — MD Media Journal`,
    description: post.standfirst,
    robots: 'index, follow',
    alternates: { canonical: `https://www.mdmmarketing.com.au/journal/${post.slug}` },
    openGraph: {
      type: 'article',
      url: `https://www.mdmmarketing.com.au/journal/${post.slug}`,
      title: post.title,
      description: post.standfirst,
      siteName: 'MD Media Marketing',
      locale: 'en_AU',
    },
  }
}

/**
 * Article in the static-pack design: header, cover, body sections with optional
 * headings and pull quotes, then the next post and a call to action.
 */
export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const [post, all] = await Promise.all([getJournalPost(slug), getJournalPosts()])
  if (!post) notFound()

  const index = all.findIndex(p => p.slug === post.slug)
  const next = all[(index + 1) % all.length]

  return (
    <div className={`${archivo.variable} ${sometype.variable} bg-ink min-h-screen`}>
      <LamaNav gate={false} />
      <main>
        {/* ── HEADER ── */}
        <header className="mx-auto max-w-[820px] px-6 pb-10 pt-28 sm:px-10 sm:pt-36">
          <a
            href="/journal"
            className="inline-flex items-center gap-2 font-lamam text-xs tracking-[0.04em] text-cream/50 no-underline transition-colors hover:text-cream"
          >
            ← all entries
          </a>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            {post.category && (
              <span className="rounded-full border border-cream/25 px-[15px] py-[7px] font-lamam text-[11px] uppercase tracking-[0.1em] text-cream">
                {post.category}
              </span>
            )}
            <Scramble
              text={[post.dateLabel, `${post.readMins} MIN READ`].filter(Boolean).join(' · ')}
              gate={false}
              className="font-lamam text-[11px] uppercase tracking-[0.1em] text-cream/50"
            />
          </div>

          <h1 className="mt-6 max-w-[20ch] font-lamah font-medium text-cream leading-[1.02] tracking-[-0.035em] text-[clamp(2.1rem,5.5vw,4.4rem)]">
            <span className="block overflow-hidden">
              <Reveal gate={false}><span className="block pb-[0.08em]">{post.title}</span></Reveal>
            </span>
          </h1>

          {post.standfirst && (
            <p className="mt-6 max-w-[54ch] font-lamah text-cream/65 text-[clamp(1.05rem,1.5vw,1.3rem)] leading-[1.55]">
              {post.standfirst}
            </p>
          )}
        </header>

        {/* ── COVER ── */}
        {post.coverUrl && (
          <section className="mx-auto max-w-[1080px] px-6 pb-[clamp(40px,7vh,80px)] sm:px-10">
            <SiteMedia
              src={post.coverUrl}
              alt={post.title}
              className="block aspect-[16/9] w-full rounded-2xl bg-ink object-cover"
            />
          </section>
        )}

        {/* ── BODY ──
            Centred at the pack's measures: 820px for the header, 1080px for
            the cover, 720px for the prose. Left-aligning these stranded the
            text against one edge on a wide screen with the artwork floating
            away from it. */}
        <section className="mx-auto max-w-[720px] px-6 pb-[clamp(60px,9vh,110px)] sm:px-10">
          <div>
            {post.sections.map((section, i) => (
              <div key={i} className="mt-10 first:mt-0">
                {section.heading && (
                  <h2 className="mb-4 font-lamah font-medium text-cream leading-[1.2] tracking-[-0.02em] text-[clamp(1.3rem,2.4vw,1.9rem)]">
                    {section.heading}
                  </h2>
                )}
                {section.paragraphs.map((p, j) => (
                  <p key={j} className="mb-5 font-lamah text-cream/75 text-[clamp(1.02rem,1.3vw,1.15rem)] leading-[1.7]">
                    {p}
                  </p>
                ))}
                {section.callout && (
                  <blockquote className="my-8 border-l-2 border-accent pl-6 font-lamah font-medium text-cream leading-[1.35] tracking-[-0.02em] text-[clamp(1.2rem,2.2vw,1.7rem)]">
                    {section.callout}
                  </blockquote>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── NEXT + CTA ── */}
        <section className="border-t border-cream/15 px-6 py-16 sm:px-10 sm:py-24">
          <div className="mx-auto max-w-[820px]">
          {next && next.slug !== post.slug && (
            <>
              <p className="m-0 mb-4 font-lamam text-[11px] uppercase tracking-widest text-cream/40">
                Next entry
              </p>
              <a href={`/journal/${next.slug}`} className="group inline-block no-underline">
                <span className="font-lamah font-medium text-cream leading-[1.1] tracking-tight text-[clamp(1.5rem,4vw,2.8rem)] transition-colors group-hover:text-accent">
                  {next.title} →
                </span>
              </a>
            </>
          )}

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
              href="/journal"
              className="border border-cream/10 px-6 py-4 font-lamam text-xs uppercase tracking-widest text-cream/60 no-underline transition-colors visited:text-cream/60 hover:border-cream/25 hover:text-cream"
            >
              ALL ENTRIES
            </a>
          </div>
          </div>
        </section>
      </main>
      <LamaFooter vol={`Journal · ${post.title}`} />
      <ScrollObserver />
    </div>
  )
}
