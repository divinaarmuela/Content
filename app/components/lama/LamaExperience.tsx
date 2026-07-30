import Reveal from './Reveal'
import { Scramble } from './Scramble'
import VoidScene from '../../void-test/VoidScene'

// Closing act of the page: the scroll-driven 3D sequence from /void-test,
// introduced in the lama language. NOTE: the scene currently uses the
// replication-study assets — swap for MD Media's own before deploying.
export default function LamaExperience() {
  return (
    <section data-lama-title="EXPERIENCE" className="!p-0">
      {/* the scene's first viewport is an empty scroll runway — the header
          overlays it (negative margin) instead of stacking dead space above */}
      <div className="relative z-10 pointer-events-none px-6 sm:px-10 pt-28 sm:pt-36 pb-10 -mb-[70vh]">
        <Scramble
          text="[ ONE MORE THING ]"
          className="font-lamam text-[11px] uppercase tracking-widest text-cream-dim"
        />
        <Reveal delay={100}>
          <h2 className="mt-8 font-lamah font-bold uppercase text-cream leading-[0.8] tracking-[-0.02em] text-[clamp(2.5rem,6.5vw,6rem)] max-w-5xl">
            Something for you to experience.
          </h2>
        </Reveal>
        <Reveal delay={200}>
          <p className="mt-8 font-lamah text-cream-dim text-lg max-w-md">
            Keep scrolling. It scrubs both ways.
          </p>
        </Reveal>
      </div>
      <VoidScene />
    </section>
  )
}
