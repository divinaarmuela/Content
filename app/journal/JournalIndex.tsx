'use client'

import { useMemo, useState } from 'react'
import { Scramble } from '../components/lama/Scramble'
import Reveal from '../components/lama/Reveal'
import Rule from '../components/lama/Rule'
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
function SubscribeForm() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (state === 'sending') return
    setState('sending')
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Something went wrong')
      setState('done')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Something went wrong')
      setState('error')
    }
  }

  if (state === 'done') {
    return (
      <p className="mt-6 font-lamam text-xs uppercase tracking-[0.06em] text-cream">
        You&rsquo;re on the list. First field notes coming soon. ✓
      </p>
    )
  }

  return (
    <form onSubmit={submit} className="mt-6">
      <div className="flex flex-wrap gap-3">
        <input
          type="email"
          required
          value={email}
          onChange={e => { setEmail(e.target.value); if (state === 'error') setState('idle') }}
          placeholder="your@email.com"
          aria-label="Email address"
          className="min-w-0 flex-1 basis-52 rounded-full border border-cream/25 bg-transparent px-6 py-4 font-lamam text-[16px] text-cream placeholder:text-cream/35 focus:border-cream/60 focus:outline-none"
        />
        <button
          type="submit"
          disabled={state === 'sending'}
          className="inline-flex items-center gap-2 rounded-full bg-cream px-7 py-4 font-lamam text-xs font-bold uppercase tracking-[0.06em] text-ink transition-opacity duration-300 hover:opacity-85 disabled:opacity-50"
        >
          {state === 'sending' ? 'subscribing…' : 'subscribe'} <span className="text-sm">&rarr;</span>
        </button>
      </div>
      {state === 'error' && (
        <p className="mt-3 font-lamam text-xs tracking-[0.06em] text-[#E2725B]">{message}</p>
      )}
    </form>
  )
}

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
      {/* Same row treatment as the homepage team list: a ◆ appears at the left
          on hover, the title dims while the meta brightens, and the rule
          underneath is two layers — a grey one that grows once on arrival,
          with a white one growing over it from the left on hover. */}
      <section className="px-6 pb-[clamp(70px,10vh,120px)] pt-[clamp(24px,4vh,48px)] sm:px-10">
        {visible.length === 0 ? (
          <p className="py-16 text-center font-lamah text-cream/50">Nothing under that topic yet.</p>
        ) : (
          <ul className="flex flex-col">
            {visible.map((post, i) => (
              <li key={post.slug} className="group">
                <a
                  href={`/journal/${post.slug}`}
                  className="relative grid grid-cols-[auto_1fr] items-baseline gap-x-5 gap-y-2 py-6 text-cream no-underline md:grid-cols-[auto_1fr_auto_auto] md:gap-x-8"
                >
                  <span
                    aria-hidden="true"
                    className="absolute left-0 font-lamam text-[11px] text-cream opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  >
                    ◆
                  </span>
                  <span className="pl-6 font-lamam text-[11px] text-cream/35 tabular-nums">
                    {pad(i + 1)}
                  </span>
                  <h3 className="font-lamah font-medium leading-[1.2] tracking-[-0.02em] text-[clamp(1.1rem,2vw,1.6rem)] transition-opacity duration-300 group-hover:opacity-60">
                    {post.title}
                  </h3>
                  {post.category && (
                    <span className="col-start-2 font-lamam text-[11px] uppercase tracking-[0.1em] text-cream/45 transition-colors duration-300 group-hover:text-cream md:col-start-auto">
                      {post.category}
                    </span>
                  )}
                  <span className="col-start-2 font-lamam text-[11px] text-cream/35 transition-colors duration-300 group-hover:text-cream md:col-start-auto md:text-right">
                    {[post.dateLabel, `${post.readMins} min`].filter(Boolean).join(' · ')}
                  </span>
                </a>
                <div className="relative">
                  <Rule once className="bg-cream/25" />
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 h-0.5 origin-left scale-x-0 bg-cream transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-x-100"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── NEWSLETTER ── collects into newsletter_subscribers via /api/subscribe */}
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
            <SubscribeForm />
          </div>
        </div>
      </section>
    </main>
  )
}
