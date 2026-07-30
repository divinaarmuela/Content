import Reveal from './Reveal'
import { Scramble } from './Scramble'

const COLUMNS = [
  { label: '[ CONTENT ]', items: ['Content Production', 'Social Media Management', 'Brand Photography', 'Video Direction'] },
  { label: '[ ADVERTISING ]', items: ['Paid Ads — Meta & Google', 'Performance Strategy', 'Lead Generation'] },
  { label: '[ BRAND & STRATEGY ]', items: ['Brand Strategy', 'Visual Identity', 'Messaging', 'Strategy & Consulting'] },
  { label: '[ DIGITAL ]', items: ['Websites', 'Front-End Development', 'Back-End Development', 'E-Commerce'] },
]

export default function LamaServices() {
  return (
    <section data-lama-title="WHAT WE DO" className="px-6 sm:px-10 py-32 sm:py-44">
      <Reveal>
        <h2 className="font-lamah font-bold uppercase text-cream leading-[0.8] tracking-[-0.02em] text-[clamp(3rem,8vw,7.5rem)]">
          What we do.
        </h2>
      </Reveal>
      <Reveal delay={150}>
        <p className="mt-10 font-lamah text-cream-dim text-lg max-w-xl">
          Start with content. Scale into the rest.
        </p>
      </Reveal>
      <Reveal delay={250}>
        <p className="mt-6 font-lamah text-cream text-xl leading-snug max-w-2xl">
          We make you visible first, then build the strategy and systems behind it.
          Content, paid, brand, and strategy under one roof — no juggling vendors.
          Your content sounds like you and looks like you, not a template.
          Start small, scale when it&rsquo;s working.
        </p>
      </Reveal>
      <div className="mt-20 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
        {COLUMNS.map((col, i) => (
          <Reveal key={col.label} delay={i * 120}>
            <Scramble text={col.label} className="font-lamam text-[11px] uppercase tracking-widest text-cream-dim" />
            <ul className="mt-6 space-y-3">
              {col.items.map((item) => (
                <li key={item} className="font-lamah text-cream text-lg">{item}</li>
              ))}
            </ul>
          </Reveal>
        ))}
      </div>
    </section>
  )
}
