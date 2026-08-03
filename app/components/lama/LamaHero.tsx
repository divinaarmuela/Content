import Reveal from './Reveal'
import { Scramble } from './Scramble'

// Reference hero structure: min-h-dvh flex items-end, mix-blend-exclusion,
// 12-col grid with the headline on cols 1-7 and the body copy bottom-aligned
// on cols 10-12. The headline reveals per line with a stagger, each line
// using the clip-path wipe recipe (handled by Reveal).
const LINES = ['You’re the best-kept', 'secret in your market.', 'Let’s fix that.']

export default function LamaHero() {
  return (
    <section
      data-lama-title="INDEX"
      className="relative min-h-[100dvh] flex items-end px-6 sm:px-10 pb-32 sm:pb-40 pt-40 mix-blend-exclusion"
    >
      <div className="w-full lg:grid lg:grid-cols-12 lg:gap-6">
        <div className="lg:col-start-1 lg:col-span-8">
          <Scramble
            text="[ CONTENT-LED MARKETING — MELBOURNE ]"
            className="mb-8 font-lamam text-[11px] uppercase tracking-widest [word-spacing:0.45em] text-cream"
          />
          <h1 className="font-lamah font-bold uppercase text-cream leading-[1.02] lg:leading-[0.92] tracking-[-0.02em] text-[clamp(2.25rem,4.7vw,5.75rem)]">
            {LINES.map((line, i) => (
              <Reveal key={line} delay={i * 120} className="block lg:whitespace-nowrap">
                {line}
              </Reveal>
            ))}
          </h1>
        </div>
        <Reveal delay={420} className="mt-10 lg:mt-0 lg:col-start-10 lg:col-span-3 lg:self-end">
          <p className="font-lamah text-cream text-lg leading-snug max-w-xs">
            Strategy. Content. Distribution. Built for founders and local businesses ready to stop blending in.
          </p>
        </Reveal>
      </div>
    </section>
  )
}
