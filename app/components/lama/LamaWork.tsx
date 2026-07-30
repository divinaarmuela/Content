import Link from 'next/link'
import Reveal from './Reveal'
import { clients, wixImg } from './workData'

export default function LamaWork() {
  return (
    <section data-lama-title="SELECTED WORK" className="bg-ink border-t border-cream/10">
      {clients.map((c, i) => (
        <Reveal key={c.name} delay={Math.min(i * 60, 240)}>
          <Link
            href="/work"
            className="group grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] items-center gap-6 px-6 sm:px-10 py-8 border-b border-cream/10 hover:bg-cream/5 transition-colors"
          >
            <div className="flex items-center gap-6 flex-wrap">
              <span className="font-lamah text-cream text-2xl sm:text-[28px]">{c.name}</span>
              <span className="flex gap-2">
                {c.services.slice(0, 3).map((s) => (
                  <span key={s} className="border border-cream-faint px-2 py-1 font-lamam text-[10px] uppercase tracking-wider text-cream-dim whitespace-nowrap">
                    {s}
                  </span>
                ))}
              </span>
            </div>
            <span className="hidden lg:block font-lamam text-xs text-cream-dim">( + )</span>
            <img
              src={wixImg(c.img, 420, 280)}
              alt={c.name}
              loading="lazy"
              className="h-[100px] sm:h-[140px] w-auto object-cover bg-ink opacity-50 group-hover:opacity-100 group-hover:scale-[1.02] transition-all duration-300"
            />
          </Link>
        </Reveal>
      ))}
    </section>
  )
}
