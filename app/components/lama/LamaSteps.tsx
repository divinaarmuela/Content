import Reveal from './Reveal'
import Rule from './Rule'
import { Scramble } from './Scramble'

// The "From invisible to in-demand" steps as reference-style stacking
// cards (lamalama.com/about-us core values): on lg each card is sticky
// with a top offset 60px below the previous and a stepped container
// height, so the next card slides over the pinned one leaving a 60px
// sliver of each earlier card. Card faces are opaque ink so they actually
// cover what they stack on. Every card opens with a growing hairline.
// Below lg the cards are plain flowed rows.
const STEPS = [
  {
    n: '01',
    title: 'Strategy call',
    desc: 'We get clear on your business, your goals, and where the gaps are. No pitch deck, no jargon, just a plan.',
    sticky: 'lg:sticky lg:top-[88px] lg:h-[340px]',
  },
  {
    n: '02',
    title: 'We build your visibility',
    desc: 'We create the content and assets that get you seen, and handle the moving parts so you can stay in your zone.',
    sticky: 'lg:sticky lg:top-[148px] lg:h-[280px]',
  },
  {
    n: '03',
    title: 'We scale what works',
    desc: 'Once you’re showing up, we add paid, brand, and strategy to turn attention into a steady flow of customers.',
    sticky: 'lg:sticky lg:top-[208px] lg:h-[220px]',
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
      <div className="relative">
        {STEPS.map((s, i) => (
          <div key={s.n} className={s.sticky}>
            <div className="bg-ink">
              <Rule delay={i * 200} />
              <Reveal delay={i * 100}>
                <div className="flex flex-col gap-6 py-6 lg:h-[200px] lg:flex-row lg:justify-between lg:gap-12 lg:py-7">
                  <div>
                    <Scramble
                      text={`[ STEP ${s.n} ]`}
                      className="font-lamam text-[11px] uppercase tracking-widest text-cream-dim"
                    />
                    <h4 className="mt-6 max-w-xl font-lamah font-medium text-cream tracking-[-0.02em] leading-[0.98] text-[clamp(1.9rem,4.2vw,3.6rem)]">
                      {s.title}
                    </h4>
                  </div>
                  <p className="font-lamah text-cream/60 text-lg leading-relaxed lg:w-4/12 lg:self-end">
                    {s.desc}
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
