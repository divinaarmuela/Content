import Reveal from './Reveal'
import Rule from './Rule'
import { Scramble } from './Scramble'

// The static-pack "BIG STATEMENT / PROBLEM" section, in our motion system:
// mono kicker over a hairline rule, then five fixed lines — the opening
// bright, the middle dimmed to 45%, and the closing phrase highlighted
// marker-style (cream background, ink text). Lines are blocks that wrap
// naturally below desktop; box-decoration-break keeps the highlight clean
// across wraps.
const dim = 'text-cream/45'
const hl =
  'bg-cream text-ink px-[0.12em] py-[0.04em] [box-decoration-break:clone] [-webkit-box-decoration-break:clone]'

export default function LamaIntro() {
  return (
    <section data-lama-title="THE PROBLEM" className="px-6 sm:px-10 pt-20 sm:pt-28 !pb-8">
      <Scramble
        text="THE PROBLEM"
        className="font-lamam text-xs uppercase tracking-[0.14em] text-cream"
      />
      <div className="mt-5 mb-12">
        <Rule />
      </div>
      {/* desktop: the reference's five composed lines. Mobile: the same
          treatment as one naturally-wrapping paragraph — fixed breaks
          double-wrap unevenly on narrow screens. */}
      <h2 className="hidden sm:block font-lamah font-normal text-cream text-[clamp(1.7rem,4.4vw,3.6rem)] leading-[1.12] tracking-[-0.03em] max-w-[1050px]">
        <Reveal className="block pb-[0.1em]">Great businesses go unseen</Reveal>
        <Reveal delay={120} className="block pb-[0.1em]">
          every day. <span className={dim}>You&rsquo;re brilliant at</span>
        </Reveal>
        <Reveal delay={240} className={`block pb-[0.1em] ${dim}`}>
          what you do and your clients love
        </Reveal>
        <Reveal delay={360} className={`block pb-[0.1em] ${dim}`}>
          you, but online, you&rsquo;re quiet. <span className={hl}>So the</span>
        </Reveal>
        <Reveal delay={480} className="block pb-[0.1em]">
          <span className={hl}>people who should buy from you don&rsquo;t know you exist.</span>
        </Reveal>
      </h2>
      <h2 className="sm:hidden font-lamah font-normal text-cream text-[1.6rem] leading-[1.2] tracking-[-0.03em]">
        <Reveal>
          <span>
            Great businesses go unseen every day.{' '}
            <span className={dim}>
              You&rsquo;re brilliant at what you do and your clients love you, but online,
              you&rsquo;re quiet.
            </span>{' '}
            <span className={hl}>
              So the people who should buy from you don&rsquo;t know you exist.
            </span>
          </span>
        </Reveal>
      </h2>
    </section>
  )
}
