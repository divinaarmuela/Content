import Reveal from './Reveal'
import { Scramble } from './Scramble'

// The static-pack "THREE STEPS" section: header row (heading left, mono
// "how it works" right), then three hairline-ruled rows on a
// [number | title | description] grid.
const STEPS = [
  {
    n: '01',
    title: 'Strategy call',
    desc: 'We get clear on your business, your goals, and where the gaps are. No pitch deck, no jargon, just a plan.',
  },
  {
    n: '02',
    title: 'We build your visibility',
    desc: 'We create the content and assets that get you seen, and handle the moving parts so you can stay in your zone.',
  },
  {
    n: '03',
    title: 'We scale what works',
    desc: 'Once you’re showing up, we add paid, brand, and strategy to turn attention into a steady flow of customers.',
  },
]

export default function LamaSteps() {
  return (
    <section data-lama-title="HOW IT WORKS" className="px-6 sm:px-10 !pt-10 pb-24">
      <div className="mb-9 flex flex-wrap items-baseline justify-between gap-4">
        <h3 className="font-lamah font-normal text-cream tracking-[-0.02em] text-[clamp(1.4rem,2.6vw,2.1rem)]">
          From invisible to in-demand
        </h3>
        <Scramble
          text="HOW IT WORKS"
          className="font-lamam text-[11px] uppercase tracking-[0.14em] text-cream/40"
        />
      </div>
      {STEPS.map((s, i) => (
        <Reveal key={s.n} delay={i * 120}>
          <div className="h-px bg-cream/[0.22]" aria-hidden="true" />
          <div className="grid items-start gap-[clamp(18px,3vw,52px)] py-11 sm:grid-cols-[90px_1fr_1.1fr]">
            <span className="font-lamam text-[13px] text-cream">{s.n}</span>
            <h4 className="font-lamah font-medium text-cream tracking-[-0.02em] text-[clamp(1.3rem,2.2vw,1.9rem)]">
              {s.title}
            </h4>
            <p className="font-lamah text-cream/60 text-[clamp(1rem,1.2vw,1.12rem)] leading-relaxed">
              {s.desc}
            </p>
          </div>
        </Reveal>
      ))}
      <div className="h-px bg-cream/[0.22]" aria-hidden="true" />
    </section>
  )
}
