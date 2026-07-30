import Reveal from './Reveal'
import { Scramble } from './Scramble'

export default function LamaHero() {
  return (
    <section
      data-lama-title="MD MEDIA MARKETING"
      className="relative min-h-[100dvh] flex flex-col justify-end px-6 sm:px-10 pb-24 pt-40"
    >
      <Scramble text="[ MD MEDIA MARKETING ]" className="absolute top-28 left-6 sm:left-10 font-lamam text-[11px] uppercase tracking-widest text-cream-dim" />
      <div className="flex flex-col lg:flex-row lg:items-end gap-10">
        <Reveal className="lg:w-2/3">
          <h1 className="font-lamah font-bold uppercase text-cream leading-[0.8] tracking-[-0.02em] text-[clamp(3rem,8vw,7.5rem)]">
            You&rsquo;re the best-kept secret in your market. Let&rsquo;s fix that.
          </h1>
        </Reveal>
        <Reveal delay={200} className="lg:w-1/3 lg:max-w-xs lg:ml-auto">
          <p className="font-lamah text-cream-dim text-base leading-relaxed">
            Strategy. Content. Distribution. Built for founders and local businesses ready to stop blending in.
          </p>
        </Reveal>
      </div>
      <div className="mt-16 h-px bg-cream/20" />
    </section>
  )
}
