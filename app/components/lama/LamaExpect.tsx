import Reveal from './Reveal'
import Rule from './Rule'
import { Scramble } from './Scramble'

// The static-pack "WHAT HAPPENS ON THE CALL" section: two columns — left
// is kicker + heading + three numbered hairline rows + a dim closer;
// right is a rounded 4:5 studio still with a tiny mono caption.
const POINTS = [
  'A straight look at where you’re visible and where you’re not.',
  'The one or two moves that’ll make the biggest difference.',
  'A clear sense of how we’d work together, only if it’s a fit.',
]

export default function LamaExpect() {
  return (
    <section data-lama-title="WHAT TO EXPECT" className="border-t border-cream/10 px-6 sm:px-10 py-24 sm:py-36">
      <div className="grid grid-cols-1 items-center gap-[clamp(36px,6vw,100px)] lg:grid-cols-2">
        <Reveal>
          <div>
            <Scramble
              text="WHAT TO EXPECT"
              className="font-lamam text-xs uppercase tracking-[0.14em] text-cream/40"
            />
            <h2 className="mt-6 mb-9 font-lamah font-normal text-cream leading-[1.06] tracking-[-0.03em] text-[clamp(1.8rem,3.8vw,3rem)]">
              What happens on the call.
            </h2>
            <ul>
              {POINTS.map((p, i) => (
                <li key={p}>
                  <Rule once className="bg-cream/[0.14]" />
                  <div className="flex gap-4 py-5 font-lamah text-cream/75 text-[1.08rem] leading-normal">
                    <span className="font-lamam text-[13px] text-cream">{`0${i + 1}`}</span>
                    {p}
                  </div>
                </li>
              ))}
            </ul>
            <Rule once className="bg-cream/[0.14]" />
            <p className="mt-7 font-lamah text-cream/50">
              It&rsquo;s a conversation, not a sales pitch. Worst case, you leave with a
              sharper plan.
            </p>
          </div>
        </Reveal>
        <Reveal delay={150}>
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/martindivina.avif"
              alt="Martin and Divina, MD Media"
              loading="lazy"
              className="block aspect-[4/5] w-full rounded-2xl object-cover bg-ink"
            />
            <span className="absolute bottom-3 left-3.5 font-lamam text-[10px] uppercase tracking-[0.12em] text-cream/75">
              image
            </span>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
