import Reveal from './Reveal'
import { Scramble } from './Scramble'

// Hero mirroring the static-pack homepage: everything centered — mono
// kicker, big two-line headline, one-sentence subline. min-h-dvh with the
// content vertically centered, mix-blend-exclusion over the backdrop.
// Headline reveals per line with a stagger (clip-path wipe via Reveal).
const LINES = ['Where great brands', 'are born.']

export default function LamaHero() {
  return (
    <section
      data-lama-title="INDEX"
      className="relative min-h-[100dvh] flex items-center justify-center px-6 sm:px-10 pb-24 pt-40 mix-blend-exclusion"
    >
      <div className="flex w-full flex-col items-center text-center">
        <Scramble
          text="[ GET SEEN · GET KNOWN · GET BOOKED ]"
          className="mb-8 font-lamam text-[11px] uppercase tracking-widest [word-spacing:0.45em] text-cream"
        />
        <h1 className="font-lamah font-medium text-cream leading-[1.02] lg:leading-[0.98] tracking-[-0.04em] text-[clamp(2rem,7vw,7rem)]">
          {LINES.map((line, i) => (
            <Reveal key={line} delay={i * 120} className="block sm:whitespace-nowrap">
              {line}
            </Reveal>
          ))}
        </h1>
        <Reveal delay={300} className="mt-8">
          <p className="font-lamah text-cream text-lg sm:text-xl leading-snug">
            You’re the best-kept secret in your market. Let’s fix that.
          </p>
        </Reveal>
      </div>
    </section>
  )
}
