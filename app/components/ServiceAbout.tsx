/**
 * Dark feature block matching the homepage AboutSection: black field, mono
 * eyebrow, large heading, stacked paragraphs, and a tall feature image.
 */
export default function ServiceAbout({
  eyebrow,
  heading,
  paragraphs,
  image,
  imageAlt = '',
}: {
  eyebrow: string
  heading: React.ReactNode
  paragraphs: React.ReactNode[]
  image: string
  imageAlt?: string
}) {
  return (
    <section className="overflow-hidden border-0 bg-[#0c0c0c] px-[clamp(20px,6vw,120px)] py-[clamp(72px,14vh,180px)] text-white">
      <div className="flex flex-col gap-16 md:flex-row md:items-start md:gap-[clamp(40px,6vw,80px)]">
        <div className="md:w-1/2">
          <p className="mb-[clamp(40px,8vh,90px)] font-mono text-[11px] uppercase tracking-[0.22em] text-white/45">
            {eyebrow}
          </p>
          <h2 className="mb-[clamp(32px,5vh,56px)] font-sans font-medium leading-[1.05] tracking-[-0.03em] text-[clamp(34px,5.5vw,76px)]">
            {heading}
          </h2>
          <div className="flex flex-col gap-[clamp(18px,2.4vh,28px)] font-sans text-[clamp(17px,1.6vw,24px)] leading-[1.5] text-white/80">
            {paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </div>
        <div className="md:w-1/2">
          <div className="about-img aspect-[3/4] w-full overflow-hidden">
            <img src={image} alt={imageAlt} className="h-full w-full object-cover" loading="lazy" />
          </div>
        </div>
      </div>
    </section>
  )
}
