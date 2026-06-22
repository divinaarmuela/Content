/**
 * Data-driven version of the homepage "Things We Do" section: light cream block,
 * mono eyebrow, big Inter-Tight heading, and a list of rows where a black panel
 * with a drifting blue blob slides down on hover. Pure CSS interaction, no JS.
 */
export type ShowcaseItem = { phase: string; title: string; desc: string }

export default function ServiceShowcase({
  eyebrow,
  heading,
  items,
}: {
  eyebrow: string
  heading: React.ReactNode
  items: ShowcaseItem[]
}) {
  return (
    <section className="border-0 bg-[#F4F0E6] py-[clamp(72px,12vh,160px)] text-[#0c0c0c]">
      <div className="px-[clamp(20px,6vw,80px)]">
        <p className="mb-[clamp(28px,5vh,56px)] font-mono text-[11px] uppercase tracking-[0.22em] text-black/45">
          {eyebrow}
        </p>
        <h2 className="mb-[clamp(40px,7vh,80px)] max-w-[18ch] font-sans font-medium leading-[1.05] tracking-[-0.03em] text-[clamp(34px,5.5vw,76px)]">
          {heading}
        </h2>
        <div className="border-b border-solid border-[#0c0c0c]">
          {items.map((step, i) => (
            <div
              key={i}
              className="group relative flex flex-col gap-4 overflow-hidden border-t border-solid border-[#0c0c0c] px-[clamp(14px,2vw,40px)] py-[clamp(28px,4vh,52px)] transition-colors duration-500 hover:text-white md:flex-row md:items-start md:justify-between md:gap-[clamp(40px,8vw,140px)]"
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-[#0c0c0c] [transform:translateY(-100%)] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:[transform:translateY(0)]"
              >
                <span
                  className="blob absolute left-0 top-1/2 -mt-[14vw] h-[28vw] w-[28vw] rounded-full bg-[radial-gradient(circle,#0057ff_0%,transparent_65%)] opacity-60"
                  style={{
                    animationName: i % 2 === 0 ? 'blobdrift' : 'blobdrift2',
                    animationDuration: `${13 + i * 2.4}s`,
                    animationDelay: `-${i * 3.7}s`,
                    animationTimingFunction: 'ease-in-out',
                    animationIterationCount: 'infinite',
                    animationDirection: i % 3 === 0 ? 'normal' : 'alternate',
                  }}
                />
              </div>
              <div className="relative z-10 md:flex-1">
                <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-[#0057FF]">
                  {step.phase}
                </span>
                <h3 className="mt-2 font-sans font-medium leading-[1.05] tracking-[-0.02em] text-[clamp(26px,3.6vw,52px)] transition-colors duration-500">
                  {step.title}
                </h3>
              </div>
              <p className="relative z-10 font-sans leading-[1.55] text-black/65 text-[clamp(15px,1.3vw,19px)] transition-colors duration-500 group-hover:text-white/70 md:max-w-[44ch] md:flex-1">
                {step.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
