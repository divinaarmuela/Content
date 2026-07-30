import Reveal from './Reveal'
import { clients, wixImg } from './workData'

// Case rows mirroring the reference's js-case-item anatomy: full-bleed row
// with a faint hairline on top, then a 12-col split — name (2/12), solid
// tag pills (3/12), a mono ( + ) (1/12), and the media right-aligned in the
// remaining half. Hover lifts the row and the thumbnail.
export default function LamaWork() {
  return (
    <section data-lama-title="SELECTED WORK" className="!pt-0 !pb-6">
      {clients.map((c, i) => (
        <Reveal key={c.name} delay={Math.min(i * 60, 240)}>
          <div
            className="group relative flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-6 px-6 sm:px-10 py-5 lg:py-6 hover:bg-cream/5 transition-colors"
          >
            <div aria-hidden="true" className="absolute left-0 right-0 top-0 h-px bg-cream opacity-20" />
            {/* mobile: stacked card — full-width media on top, then the name
                row with ( + ) pushed right, tags wrapping below */}
            <img
              src={wixImg(c.img, 760, 480)}
              alt=""
              loading="lazy"
              className="lg:hidden w-full aspect-video object-cover bg-ink"
            />
            <span className="flex items-baseline justify-between lg:block lg:w-2/12">
              <span className="font-lamah text-cream text-lg sm:text-xl">{c.name}</span>
              <span className="font-lamam text-xs text-cream-dim lg:hidden">( + )</span>
            </span>
            <span className="flex flex-wrap gap-1 lg:w-3/12">
              {c.services.slice(0, 3).map((s) => (
                <span key={s} className="bg-cream/10 px-2 py-1 font-lamam text-[10px] uppercase tracking-wider text-cream whitespace-nowrap">
                  {s}
                </span>
              ))}
            </span>
            <span className="hidden lg:block font-lamam text-xs text-cream-dim lg:w-1/12">( + )</span>
            <span className="hidden lg:flex justify-end lg:flex-1">
              <img
                src={wixImg(c.img, 420, 280)}
                alt={c.name}
                loading="lazy"
                className="h-[90px] sm:h-[120px] w-auto object-cover bg-ink opacity-75 group-hover:opacity-100 group-hover:scale-[1.02] transition-all duration-300"
              />
            </span>
          </div>
        </Reveal>
      ))}
    </section>
  )
}
