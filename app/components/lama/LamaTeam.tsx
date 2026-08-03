import Link from 'next/link'
import Reveal from './Reveal'
import Rule from './Rule'

// The static-pack "THE PEOPLE YOU'LL WORK WITH" section with the
// reference list interactions: rows separated by scroll-growing rules;
// on hover a ◆ dot appears, a white quip chip pops in above the name,
// the role brightens to full cream and the name dims.
const TEAM = [
  { name: 'Divina', role: 'Co-Founder & Managing Director', quip: 'reads people for a living' },
  { name: 'Martin', role: 'Co-Founder & Chief Production Officer', quip: 'knows what makes you stop' },
  { name: 'Abby', role: 'Head of Operations', quip: 'keeps the machine running' },
  { name: 'Yusuf', role: 'Head of Paid Media', quip: 'spends it like it is his' },
  { name: 'Lulu', role: 'Senior Account Manager', quip: 'never drops a ball' },
  { name: 'Manal', role: 'Senior Account Manager', quip: 'turns chaos into calm' },
  { name: 'Karly', role: 'Social Media Strategist', quip: 'fluent in three feeds' },
  { name: 'Renee', role: 'Social Media Strategist', quip: 'writes like she talks' },
  { name: 'Raven', role: 'Social Media Strategist', quip: 'early to every trend' },
  { name: 'Daniela', role: 'Brand & Graphic Designer', quip: 'obsessed with the grid' },
  { name: 'Akmal', role: 'Technology & Systems Lead', quip: 'automates the boring parts' },
  { name: 'Ryan', role: 'Video Editor & Cinematographer', quip: 'lives in the timeline' },
  { name: 'Sebastian', role: 'Photographer & Cinematographer', quip: 'chases the right light' },
  { name: 'Sarina', role: 'Photographer & Cinematographer', quip: 'makes people forget the lens' },
]

export default function LamaTeam() {
  return (
    <section data-lama-title="THE PEOPLE" className="border-t border-cream/10 px-6 sm:px-10 py-24 sm:py-36">
      <h2 className="mb-[clamp(32px,5vh,60px)] max-w-[14ch] font-lamah font-bold uppercase text-cream leading-[0.9] tracking-[-0.045em] text-[clamp(2.6rem,9.2vw,8.5rem)]">
        {['The people', 'you’ll work', 'with'].map((line, i) => (
          <Reveal key={line} delay={i * 120} className="block pb-[0.06em]">
            {line}
          </Reveal>
        ))}
      </h2>
      <Reveal delay={300}>
        <p className="max-w-[46ch] font-lamah text-cream/70 text-[clamp(1.05rem,1.5vw,1.4rem)] leading-normal">
          We are a hands-on team that works close and moves quick. No overhead, just
          people who enjoy building side by side. Everyone adds their own spark.
          Different minds and shared drive, that is what makes the work better and
          the days more fun.{' '}
          <Link href="/about" className="border-b border-cream/40 text-cream no-underline">
            Read our story →
          </Link>
        </p>
      </Reveal>

      {/* reference layout: the member list is a half-width column pushed to
          the RIGHT of the page, each row closed by a growing line */}
      <div className="flex flex-col items-end pt-[clamp(40px,14vh,160px)]">
        <div className="w-full lg:w-6/12">
          {TEAM.map(m => (
            <div key={m.name} className="group">
              <div className="relative flex min-h-14 items-center gap-[clamp(14px,2vw,28px)] py-2.5">
                <span
                  aria-hidden="true"
                  className="absolute left-0 font-lamam text-[11px] text-cream opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                >
                  ◆
                </span>
                <span className="w-1/2 min-w-0 pl-6 font-lamah font-medium text-cream leading-[1.1] tracking-[-0.025em] text-[clamp(1.05rem,1.5vw,1.5rem)] transition-opacity duration-300 group-hover:opacity-60">
                  {m.name}
                </span>
                <span className="w-1/2 font-lamam uppercase tracking-[0.08em] text-cream/45 text-[clamp(9px,0.85vw,11px)] transition-colors duration-300 group-hover:text-cream">
                  [ {m.role} ]
                </span>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -top-2 left-6 z-[5] whitespace-nowrap bg-cream px-2.5 py-1.5 font-lamam text-[10px] uppercase tracking-[0.08em] text-ink opacity-0 translate-y-1 transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-y-0 group-hover:opacity-100"
                >
                  {m.quip}
                </span>
              </div>
              {/* two-layer row line: grey grows once on arrival; on hover a
                  white line grows over it from the left */}
              <div className="relative">
                <Rule once className="bg-cream/25" />
                <div
                  aria-hidden="true"
                  className="absolute inset-0 h-0.5 origin-left scale-x-0 bg-cream transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-x-100"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
