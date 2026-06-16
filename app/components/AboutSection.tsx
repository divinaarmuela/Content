export default function AboutSection() {
  return (
    <section className="border-0 bg-[#0c0c0c] px-[clamp(20px,6vw,120px)] py-[clamp(72px,14vh,180px)] text-white">
      <div className="flex flex-col gap-16 md:flex-row md:items-start md:gap-[clamp(40px,6vw,80px)]">

        {/* Left: text */}
        <div className="md:w-1/2">
          <p className="mb-[clamp(40px,8vh,90px)] font-mono text-[11px] uppercase tracking-[0.22em] text-white/45">
            &middot; Behind MD Media
          </p>
          <h2 className="mb-[clamp(32px,5vh,56px)] font-sans font-medium leading-[1.05] tracking-[-0.03em] text-[clamp(34px,5.5vw,76px)]">
            Building Brands That Actually Grow
          </h2>
          <div className="flex flex-col gap-[clamp(18px,2.4vh,28px)] font-sans text-[clamp(17px,1.6vw,24px)] leading-[1.5] text-white/80">
            <p>
              Most agencies are built by marketers. We&apos;re built by people who&apos;ve lived on both sides of the camera.
            </p>
            <p>
              Divina spent years understanding what makes people follow, trust, and buy. Not from a textbook, but from being in the world of influence and watching human behaviour up close. Martin built his eye through media and production, learning what makes someone stop, stay, and feel something.
            </p>
            <p>
              When they came together in late 2024, MD Media was the only logical outcome. A studio that doesn&apos;t just produce content. It understands the psychology behind why content works.
            </p>
            <p>
              Today, MD Media runs content ecosystems with a team of 15 for businesses across finance, hospitality, real estate, health, automotive, and personal brands. From strategy to the final frame, everything stays in-house.
            </p>
          </div>
        </div>

        {/* Right: single feature image */}
        <div className="md:w-1/2">
          <div className="about-img aspect-[3/4] w-full overflow-hidden">
            <img
              src="/martindivina.avif"
              alt=""
              aria-hidden="true"
              className="h-full w-full object-cover"
            />
          </div>
        </div>

      </div>
    </section>
  )
}
