import Reveal from './Reveal'
import { Scramble } from './Scramble'

// The static-pack "IMPACT / CLIENT" section: slightly lifted background,
// client quote on the left (kicker, blockquote, mono attribution), and a
// numbered "what we did" list on the right with hairline row rules.
const DID = ['Complete brand redesign', 'Service launch strategy', 'Content production']

export default function LamaClient() {
  return (
    <section
      data-lama-title="CLIENT IMPACT"
      className="border-t border-cream/10 bg-[#0E0E0E] px-6 sm:px-10 py-24 sm:py-32"
    >
      <div className="grid grid-cols-1 items-center gap-[clamp(36px,6vw,100px)] lg:grid-cols-[1.1fr_1fr]">
        <Reveal>
          <div>
            <Scramble
              text="CLIENT / @BEAUTYBLVD"
              className="font-lamam text-[11px] uppercase tracking-[0.14em] text-cream/40"
            />
            <blockquote className="mt-7 mb-8 font-lamah font-normal text-cream leading-[1.3] tracking-[-0.02em] text-[clamp(1.4rem,2.6vw,2.1rem)]">
              &ldquo;Their attention to detail, thorough planning, and strategic guidance
              made what could have been an overwhelming process feel incredibly organised
              and manageable.&rdquo;
            </blockquote>
            <p className="font-lamam text-xs text-cream/50">Angelique Mangion, Beauty Blvd</p>
          </div>
        </Reveal>
        <Reveal delay={150}>
          <div className="flex flex-col">
            <Scramble
              text="WHAT WE DID"
              className="mb-4 font-lamam text-[11px] uppercase tracking-[0.14em] text-cream/40"
            />
            {DID.map((item, i) => (
              <div
                key={item}
                className={`flex items-baseline gap-4 border-t border-cream/[0.14] py-6 ${i === DID.length - 1 ? 'border-b' : ''}`}
              >
                <span className="font-lamam text-xs text-cream">{`0${i + 1}`}</span>
                <div className="font-lamah font-medium text-cream leading-tight tracking-[-0.02em] text-[clamp(1.2rem,2vw,1.7rem)]">
                  {item}
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}
