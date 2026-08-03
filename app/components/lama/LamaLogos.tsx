// self-hosted in /public/logos (downloaded from the old Wix CDN, which was
// intermittently failing to serve) — tiny PNGs, no third-party dependency
const logos = Array.from({ length: 13 }, (_, i) => `/logos/logo-${String(i + 1).padStart(2, '0')}.png`)

export default function LamaLogos() {
  const doubled = [...logos, ...logos]
  return (
    // transparent over the shared canvas, like the reference's logos section
    <div aria-label="Clients and partners" className="py-10 overflow-hidden">
      <p className="mb-8 text-center font-lamam text-[11px] uppercase tracking-widest text-cream-dim">
        Trusted by founders &amp; local businesses
      </p>
      <div className="flex w-max animate-lama-marquee motion-reduce:animate-none gap-16 px-8">
        {doubled.map((logo, i) => (
          <img
            key={i}
            src={logo}
            alt=""
            loading="lazy"
            className="h-10 w-auto opacity-70 [filter:brightness(0)_invert(1)]"
          />
        ))}
      </div>
    </div>
  )
}
