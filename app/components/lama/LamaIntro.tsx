import Reveal from './Reveal'
import { Scramble } from './Scramble'

export default function LamaIntro() {
  return (
    <section data-lama-title="THE PROBLEM" className="bg-ink px-6 sm:px-10 py-32 sm:py-44">
      <Reveal>
        <p className="font-lamah text-cream text-[clamp(1.75rem,3.4vw,2.75rem)] leading-tight max-w-4xl [text-indent:3em]">
          You&rsquo;re brilliant at what you do. Your clients love you. But online? You&rsquo;re quiet.
          The result is the same: the people who should be hiring you don&rsquo;t know you exist.
        </p>
      </Reveal>
      <div className="mt-20 flex justify-end">
        <Scramble text="[ FEATURED WORK ]" className="font-lamam text-[11px] uppercase tracking-widest text-cream-dim" />
      </div>
    </section>
  )
}
