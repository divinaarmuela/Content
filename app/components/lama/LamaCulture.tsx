import Reveal from './Reveal'
import { Scramble } from './Scramble'

export default function LamaCulture() {
  return (
    <section data-lama-title="A NEW APPROACH" className="grid grid-cols-1 lg:grid-cols-[55%_45%]">
      <div className="px-6 sm:px-10 py-32">
        <Scramble text="[ A NEW APPROACH ]" className="font-lamam text-[11px] uppercase tracking-widest text-cream-dim" />
        <Reveal delay={100}>
          <p className="mt-10 font-lamah text-cream text-[clamp(1.5rem,2.6vw,2.25rem)] leading-tight [text-indent:3em]">
            There are two kinds of businesses now: the ones people can&rsquo;t stop talking
            about, and the ones nobody&rsquo;s heard of yet. We build the first kind.
          </p>
        </Reveal>
        <Reveal delay={200}>
          <p className="mt-8 font-lamah text-cream-dim text-lg leading-relaxed max-w-xl">
            We don&rsquo;t start by selling you the whole machine. We start with visibility,
            content built around you, your story, and your offer, so you show up where
            your customers already are.
          </p>
        </Reveal>
        <Reveal delay={280}>
          <p className="mt-5 font-lamah text-cream-dim text-lg leading-relaxed max-w-xl">
            Then, as it works, we scale: paid to put fuel behind it, brand to make it
            look the part, strategy to tie it together. One partner who grows with you,
            not five freelancers you have to manage.
          </p>
        </Reveal>
      </div>
      <div className="relative min-h-[320px] lg:min-h-0">
        <img
          src="/martindivina.avif"
          alt="Martin and Divina, MD Media"
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      </div>
    </section>
  )
}
