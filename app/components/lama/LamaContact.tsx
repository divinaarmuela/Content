import Link from 'next/link'
import Reveal from './Reveal'
import { Scramble } from './Scramble'

const CALENDLY = 'https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone'

export default function LamaContact() {
  return (
    <section data-lama-title="BOOK A CALL" className="px-6 sm:px-10 pt-32 sm:pt-44 pb-40">
      <Reveal>
        <h2 className="font-lamah font-bold uppercase text-cream leading-[0.8] tracking-[-0.02em] text-[clamp(2.75rem,7.5vw,7rem)] max-w-5xl">
          Ready to stop being the best-kept secret?
        </h2>
      </Reveal>
      <div className="mt-16 max-w-lg">
        <Scramble text="[ GET IN TOUCH ]" className="font-lamam text-[11px] uppercase tracking-widest text-cream-dim" />
        <Reveal delay={100}>
          <p className="mt-6 font-lamah text-cream-dim text-lg leading-relaxed">
            Book a free strategy call. We&rsquo;ll look at where you&rsquo;re invisible, where the
            opportunity is, and exactly what we&rsquo;d do first. No obligation, no hard sell.
          </p>
        </Reveal>
      </div>
      <Reveal delay={200}>
        <div className="mt-12 flex flex-wrap gap-4">
          <a
            href={CALENDLY}
            target="_blank"
            rel="noreferrer noopener"
            className="border border-cream/25 px-6 py-4 font-lamam text-xs uppercase tracking-widest text-cream visited:text-cream no-underline hover:bg-cream hover:text-ink transition-colors"
          >
            BOOK A STRATEGY CALL ↗
          </a>
          <Link
            href="/work"
            className="border border-cream/25 px-6 py-4 font-lamam text-xs uppercase tracking-widest text-cream visited:text-cream no-underline hover:bg-cream hover:text-ink transition-colors"
          >
            SEE OUR WORK ↗
          </Link>
        </div>
      </Reveal>
    </section>
  )
}
