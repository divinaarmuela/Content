import Reveal from './Reveal'
import { Scramble } from './Scramble'

export default function LamaCulture() {
  return (
    <section data-lama-title="WHY MD MEDIA" className="grid grid-cols-1 lg:grid-cols-[55%_45%]">
      <div className="px-6 sm:px-10 py-32">
        <Scramble text="[ WHY US ]" className="font-lamam text-[11px] uppercase tracking-widest text-cream-dim" />
        <Reveal delay={100}>
          <p className="mt-10 font-lamah text-cream text-[clamp(1.5rem,2.6vw,2.25rem)] leading-tight [text-indent:3em]">
            We make you visible first, then build the strategy and systems behind it.
            Content, paid, brand, and strategy under one roof — no juggling vendors.
            Your content sounds like you and looks like you, not a template.
            Start small, scale when it&rsquo;s working.
          </p>
        </Reveal>
      </div>
      <div className="relative min-h-[320px] lg:min-h-0">
        <img
          src="https://static.wixstatic.com/media/c5a69a_cbe685f642bb4d75b6f9b0759d5482e2~mv2.jpg/v1/fill/w_1200,h_1200,al_c,q_85,enc_avif,quality_auto/c5a69a_cbe685f642bb4d75b6f9b0759d5482e2~mv2.jpg"
          alt="MD Media behind the scenes"
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      </div>
    </section>
  )
}
