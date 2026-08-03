import Reveal from './Reveal'
import { Scramble } from './Scramble'

// The static-pack "A NEW ERA / MANIFESTO" section: dim mono kicker, four
// light-weight statement lines revealing one by one, then a two-column
// paragraph grid — first paragraph at 70% cream, second at 50%.
const LINES = [
  'There are two kinds of businesses now:',
  'the ones people can’t stop talking about,',
  'and the ones nobody’s heard of yet.',
  'We build the first kind.',
]

export default function LamaCulture() {
  return (
    <section data-lama-title="A NEW APPROACH" className="border-t border-cream/10 px-6 sm:px-10 py-32 sm:py-40">
      <Scramble
        text="A NEW APPROACH"
        className="font-lamam text-xs uppercase tracking-[0.14em] text-cream/40"
      />
      <h2 className="mt-11 mb-14 max-w-[1050px] font-lamah font-light text-cream leading-[1.25] tracking-[-0.025em] text-[clamp(1.5rem,3.4vw,2.8rem)]">
        {LINES.map((line, i) => (
          <Reveal key={line} delay={i * 120} className="block pb-[0.08em]">
            {line}
          </Reveal>
        ))}
      </h2>
      <div className="grid max-w-[980px] grid-cols-1 gap-[clamp(28px,4vw,72px)] sm:grid-cols-2">
        <Reveal delay={200}>
          <p className="font-lamah text-cream/70 text-[clamp(1rem,1.25vw,1.18rem)] leading-relaxed">
            We don&rsquo;t start by selling you the whole machine. We start with visibility,
            content built around you, your story, and your offer, so you show up where
            your customers already are.
          </p>
        </Reveal>
        <Reveal delay={320}>
          <p className="font-lamah text-cream/50 text-[clamp(1rem,1.25vw,1.18rem)] leading-relaxed">
            Then, as it works, we scale: paid to put fuel behind it, brand to make it
            look the part, strategy to tie it together. One partner who grows with you,
            not five freelancers you have to manage.
          </p>
        </Reveal>
      </div>
    </section>
  )
}
