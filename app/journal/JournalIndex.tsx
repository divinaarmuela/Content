'use client'

import { useMemo, useState } from 'react'
import { Scramble } from '../components/lama/Scramble'
import Reveal from '../components/lama/Reveal'
import SiteMedia from '../components/SiteMedia'
import type { JournalPost } from '../lib/journalPosts'

/**
 * Journal index in the static-pack design: hero with an entry count, one
 * featured post, a topic rail, then thin-line numbered rows.
 *
 * The rail is built from the posts' own topics rather than a fixed list — same
 * reasoning as the /work service chips. A topic typed in the CMS becomes a
 * filter here with nothing else to edit.
 */
export default function JournalIndex({ posts }: { posts: JournalPost[] }) {
  const [topic, setTopic] = useState<string>('all')

  const topics = useMemo(() => {
    const seen = new Map<string, string>()
    for (const p of posts) {
      const label = p.category.trim()
      if (label && !seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label)
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  }, [posts])

  // a topic that has since been renamed would strand the reader on an empty
  // list with no way back
  const active = topic !== 'all' && topics.includes(topic) ? topic : 'all'

  const featured = posts.find(p => p.featured) ?? posts[0]
  const rest = posts.filter(p => p.slug !== featured?.slug)
  const visible = rest.filter(
    p => active === 'all' || p.category.toLowerCase() === active.toLowerCase(),
  )

  const pad = (n: number) => String(n).padStart(2, '0')

  return (
    <main className="relative z-10">
      {/* ── HERO ── */}
      <header className="px-6 pt-40 sm:px-10 sm:pt-48">
        <div className="flex flex-wrap items-end justify-between gap-8">
          <div>
            <Scramble
              text="THE JOURNAL / FIELD NOTES ON GETTING SEEN"
              gate={false}
              className="font-lamam text-[11px] uppercase tracking-[0.14em] text-cream/50"
            />
            <h1 className="mt-6 font-lamah font-medium text-cream leading-[0.98] tracking-[-0.04em] text-[clamp(2.8rem,9vw,7rem)]">
              <span className="block overflow-hidden">
                <Reveal gate={false}><span className="block pb-[0.08em]">Journal</span></Reveal>
              </span>
            </h1>
          </div>
          <p className="max-w-[38ch] font-lamah text-cream/60 text-[clamp(1rem,1.3vw,1.15rem)] leading-[1.55]">
            Writing on content, brand, and visibility for founders and local businesses.
            <br />
            <span className="font-lamam text-[11px] uppercase tracking-[0.14em] text-cream/40">
              {pad(posts.length)} {posts.length === 1 ? 'entry' : 'entries'}
            </span>
          </p>
        </div>
        <div className="mt-12 h-px bg-cream/15" />
      </header>

      {/* ── FEATURED ── */}
      {featured && (
        <section className="px-6 pt-[clamp(40px,6vh,72px)] sm:px-10">
          <a href={`/journal/${featured.slug}`} className="group block text-cream no-underline">
            {featured.coverUrl && (
              <div className="relative overflow-hidden rounded-[14px]">
                <SiteMedia
                  src={featured.coverUrl}
                  alt={featured.title}
                  className="block aspect-[21/9] w-full bg-ink object-cover transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03]"
                />
                <span className="absolute bottom-3 left-4 rounded-full bg-cream px-3 py-1 font-lamam text-[10px] uppercase tracking-[0.12em] text-ink">
                  featured
                </span>
              </div>
            )}
            <div className="mt-6 flex flex-wrap items-center gap-4 font-lamam text-[11px] uppercase tracking-[0.1em] text-cream/50">
              {featured.category && (
                <span className="rounded-full border border-cream/25 px-3 py-1 text-cream">
                  {featured.category}
                </span>
              )}
              <span>{featured.readMins} min read</span>
              {featured.dateLabel && <span>{featured.dateLabel}</span>}
            </div>
            <h2 className="mt-4 max-w-[22ch] font-lamah font-medium leading-[1.08] tracking-[-0.03em] text-[clamp(1.8rem,4vw,3.2rem)]">
              {featured.title}
            </h2>
            {featured.standfirst && (
              <p className="mt-4 max-w-[60ch] font-lamah text-cream/55 text-[1.05rem] leading-[1.55]">
                {featured.standfirst}
              </p>
            )}
          </a>
        </section>
      )}

      {/* ── TOPIC RAIL ── */}
      {topics.length > 0 && (
        <section className="px-6 pt-[clamp(48px,8vh,90px)] sm:px-10">
          <div className="h-px bg-cream/15" />
          <div className="flex flex-wrap items-center gap-2.5 py-5">
            <span className="mr-2 font-lamam text-[11px] uppercase tracking-[0.14em] text-cream/40">
              topics
            </span>
            {['all', ...topics].map(key => (
              <button
                key={key}
                type="button"
                onClick={() => setTopic(key)}
                className={`cursor-pointer appearance-none rounded-full border-0 px-[15px] py-[7px] font-lamam text-xs transition-colors duration-300 ${
                  active === key
                    ? 'bg-cream text-ink'
                    : 'bg-transparent text-cream/70 shadow-[inset_0_0_0_1px_rgba(249,244,235,0.25)] hover:text-cream'
                }`}
              >
                {key === 'all' ? 'All' : key}
              </button>
            ))}
          </div>
          <div className="h-px bg-cream/15" />
        </section>
      )}

      {/* ── INDEX ROWS ── */}
      <section className="px-6 pb-[clamp(70px,10vh,120px)] pt-[clamp(24px,4vh,48px)] sm:px-10">
        {visible.length === 0 ? (
          <p className="py-16 text-center font-lamah text-cream/50">Nothing under that topic yet.</p>
        ) : (
          <ul className="flex flex-col">
            {visible.map((post, i) => (
              <li key={post.slug}>
                <a
                  href={`/journal/${post.slug}`}
                  className="group grid grid-cols-[auto_1fr] items-baseline gap-x-5 gap-y-2 border-b border-cream/12 py-6 text-cream no-underline transition-colors hover:border-cream/40 md:grid-cols-[auto_1fr_auto_auto] md:gap-x-8"
                >
                  <span className="font-lamam text-[11px] text-cream/35 tabular-nums">{pad(i + 1)}</span>
                  <h3 className="font-lamah font-medium leading-[1.2] tracking-[-0.02em] text-[clamp(1.1rem,2vw,1.6rem)] transition-colors group-hover:text-accent">
                    {post.title}
                  </h3>
                  {post.category && (
                    <span className="col-start-2 font-lamam text-[11px] uppercase tracking-[0.1em] text-cream/45 md:col-start-auto">
                      {post.category}
                    </span>
                  )}
                  <span className="col-start-2 font-lamam text-[11px] text-cream/35 md:col-start-auto md:text-right">
                    {[post.dateLabel, `${post.readMins} min`].filter(Boolean).join(' · ')}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── NEWSLETTER ──
          A mailto rather than a fake subscribe box: there is no list to add
          anyone to yet, and a form that silently does nothing is worse than
          an honest link. Swap the href for a real endpoint when one exists. */}
      <section className="border-t border-cream/[0.12] px-6 py-[clamp(70px,11vh,140px)] sm:px-10">
        <div className="grid items-center gap-[clamp(28px,5vw,80px)] lg:grid-cols-[1.1fr_1fr]">
          <h2 className="m-0 font-lamah font-medium text-cream leading-[1.05] tracking-[-0.03em] text-[clamp(1.8rem,4vw,3rem)]">
            Field notes, straight to your inbox.
          </h2>
          <div>
            <p className="m-0 font-lamah text-cream/55 text-[1.02rem] leading-[1.55]">
              Occasional, practical writing on getting seen, known, and booked. No spam,
              unsubscribe anytime.
            </p>
            <a
              href="mailto:hello@mdmmarketing.com.au?subject=Subscribe%20to%20field%20notes"
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-cream px-7 py-4 font-lamam text-xs font-bold uppercase tracking-[0.06em] text-ink no-underline transition-opacity duration-300 hover:opacity-85"
            >
              subscribe <span className="text-sm">&rarr;</span>
            </a>
          </div>
        </div>
      </section>
    </main>
  )
}
