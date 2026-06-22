/** Light, edge-to-edge frame grid: selected stills in the cream theme. */
export default function ServiceGallery({
  eyebrow,
  right,
  images,
  alt = '',
}: {
  eyebrow: string
  right: string
  images: string[]
  alt?: string
}) {
  return (
    <section className="border-0 bg-[#F4F0E6] pb-[clamp(40px,8vh,96px)] pt-[clamp(8px,2vh,24px)]">
      <div className="mb-5 flex items-center justify-between px-[clamp(20px,6vw,80px)] font-mono text-[11px] uppercase tracking-[0.18em] text-black/45">
        <span>{eyebrow}</span>
        <span>{right}</span>
      </div>
      <div className="grid grid-cols-2 gap-[2px] md:grid-cols-4">
        {images.map((src, i) => (
          <div key={i} className="group relative aspect-[4/5] overflow-hidden bg-[#0c0c0c]">
            <img
              src={src}
              alt={alt}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.05]"
            />
            <span className="absolute bottom-3 left-3 font-mono text-[10px] uppercase tracking-[0.16em] text-white/80">
              FRM_0{i + 1}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
