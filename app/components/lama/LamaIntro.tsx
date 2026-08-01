import Reveal from './Reveal'
import { Scramble } from './Scramble'

// Paragraph reveals per line with a stagger, same recipe as the hero
// headline. Sits transparent over the shared canvas like every dark section.
// The hard line splits assume desktop width — below sm the text reveals as
// two naturally-wrapping sentences instead, so no ragged mid-phrase breaks.
const LINES = [
  'You’re brilliant at what you do. Your',
  'clients love you. But online? You’re quiet.',
  'The result is the same: the people who',
  'should be hiring you don’t know you exist.',
]

const SENTENCES = [
  'You’re brilliant at what you do. Your clients love you. But online? You’re quiet.',
  'The result is the same: the people who should be hiring you don’t know you exist.',
]

export default function LamaIntro() {
  return (
    <section data-lama-title="THE PROBLEM" className="px-6 sm:px-10 pt-20 sm:pt-28 !pb-8">
      <div className="hidden sm:block font-lamah text-cream text-[clamp(1.75rem,3.4vw,2.75rem)] leading-tight max-w-4xl">
        {LINES.map((line, i) => (
          <Reveal key={line} delay={i * 120} className={`block ${i === 0 ? '[text-indent:2em]' : ''}`}>
            {line}
          </Reveal>
        ))}
      </div>
      <div className="sm:hidden font-lamah text-cream text-[1.5rem] leading-tight">
        {SENTENCES.map((sentence, i) => (
          <Reveal key={sentence} delay={i * 160} className={`block ${i > 0 ? 'mt-4' : ''}`}>
            {sentence}
          </Reveal>
        ))}
      </div>
      <div className="mt-8 flex justify-end">
        <Scramble text="[ FEATURED WORK ]" className="font-lamam text-[11px] uppercase tracking-widest text-cream-dim" />
      </div>
    </section>
  )
}
