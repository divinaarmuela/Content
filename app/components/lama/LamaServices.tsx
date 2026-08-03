import RecedeCard from './RecedeCard'
import Reveal from './Reveal'
import SiteMedia from '../SiteMedia'
import { Scramble } from './Scramble'

// The static-pack SERVICES section: kicker + two-line heading + intro,
// then five alternating rows (text | media, media side flipping each row)
// separated by scroll-scrubbed rules. Text block: numbered title, dim
// description, two-column mono "+" bullet list. Media: rounded 4:3 slot
// with a tiny mono caption, image or muted looping video via SiteMedia.
const SERVICES = [
  {
    n: '01',
    title: 'Strategy & Consulting',
    desc: 'Sometimes you don’t need more content, you need a clearer direction. We sharpen your positioning, fix your offers, and map the path from where you are to where you want to be. Then we build it, or hand you the playbook.',
    items: ['Positioning', 'Offer & pricing review', 'Marketing roadmap', 'Ongoing advisory'],
    media: '/martindivina.avif', 
  },

  {
    n: '02',
    title: 'Branding Suite',
    desc: 'A strong brand makes everything else work harder, your content earns more trust, your ads convert better, your prices hold. We build the full identity: how you look, how you sound, and how you’re remembered.',
    items: ['Logo & identity', 'Messaging & voice', 'Colour & type system', 'Templates & assets'],
    media: '/Senorita.mp4',
  },
  {
    n: '03',
    title: 'Custom Websites',
    desc: 'A website is where interest turns into enquiries. We design and build fast, custom sites that look like your brand and are built to convert, not template drag-and-drop. Then we keep them running so they never go stale.',
    items: ['Design & build', 'Copy & structure', 'Mobile & speed', 'Hosting & care'],
    media: '/website-landscape.mp4',
  },
  {
    n: '04',
    title: 'Content & Visibility',
    desc: 'If people can’t see you, nothing else matters. We create the photo, video, and social content that makes you look established and keeps you consistently in front of the right audience, without you becoming a full-time creator. We also run full campaign shoots for brands, taking a vision from ideation and concepting through to production and final execution.',
    items: ['Content strategy', 'Photo, video & campaign shoots', 'Social & captions', 'Ongoing posting'],
    media: '/cecconis.mp4',
  },
  {
    n: '05',
    title: 'Paid Advertising',
    desc: 'Content gets you seen. Paid gets you seen by the exact people most likely to buy. We plan, build, and manage campaigns across Meta, Google, and more, then optimise against what matters: enquiries, bookings, and revenue.',
    items: ['Campaign strategy', 'Ad creative & copy', 'Setup & management', 'Clear reporting'],
    media: '/Automodellista.mp4',
  },
]

const isVideo = (src: string) => /\.(mp4|webm|mov)(\?|$)/i.test(src)

export default function LamaServices() {
  return (
    <section
      id="services"
      data-lama-title="SERVICES, NOT PACKAGES"
      className="scroll-mt-[70px] border-t border-cream/10 px-6 sm:px-10 py-24 sm:py-36"
    >
      <div className="mb-[clamp(48px,7vh,80px)] max-w-[760px]">
        <Scramble
          text="SERVICES, NOT PACKAGES"
          className="font-lamam text-xs uppercase tracking-[0.14em] text-cream/40"
        />
        <h2 className="mt-6 mb-6 font-lamah font-normal text-cream leading-[1.05] tracking-[-0.03em] text-[clamp(2rem,4.6vw,3.6rem)]">
          {['We meet you', 'where you’re at.'].map((line, i) => (
            <Reveal key={line} delay={i * 120} className="block pb-[0.1em]">
              {line}
            </Reveal>
          ))}
        </h2>
        <Reveal delay={240}>
          <p className="font-lamah text-cream/55 text-[clamp(1rem,1.3vw,1.18rem)] leading-relaxed">
            There&rsquo;s no fixed starting point. Some businesses need a clear strategy first;
            others need a brand, a campaign shoot, content, or paid, or all of it.
            We start wherever you are and build out from there.
          </p>
        </Reveal>
      </div>

      {/* the perspective container — the receding cards' translateZ projects
          against this, lusion-style. Each card pins; the next slides over it
          while the pinned one sinks back. */}
      <div className="relative [perspective:1400px]">
      {SERVICES.map((s, i) => (
        <RecedeCard key={s.n} isLast={i === SERVICES.length - 1}>
          <div className="grid grid-cols-1 items-center gap-[clamp(28px,5vw,80px)] rounded-2xl border border-cream/10 bg-ink px-6 py-10 sm:px-10 lg:grid-cols-[1fr_0.95fr] lg:py-12">
            <Reveal delay={100} className={i % 2 === 1 ? 'lg:order-2' : undefined}>
              <div>
                <div className="mb-5 flex items-baseline gap-4">
                  <span className="font-lamam text-[13px] text-cream">{s.n}</span>
                  <h3 className="font-lamah font-medium text-cream tracking-[-0.02em] text-[clamp(1.6rem,3vw,2.4rem)]">
                    {s.title}
                  </h3>
                </div>
                <p className="mb-6 font-lamah text-cream/65 text-[clamp(1rem,1.2vw,1.12rem)] leading-relaxed">
                  {s.desc}
                </p>
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {s.items.map(item => (
                    <li key={item} className="flex gap-2 font-lamam text-xs text-cream/55">
                      <span className="text-cream">+</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
            <Reveal delay={200} className={i % 2 === 1 ? 'lg:order-1' : undefined}>
              <div className="relative">
                <SiteMedia
                  src={s.media}
                  alt={s.title}
                  className="block aspect-[4/3] w-full rounded-[14px] object-cover bg-ink"
                />
                <span className="absolute bottom-3 left-3.5 font-lamam text-[10px] uppercase tracking-[0.12em] text-cream/75">
                  {isVideo(s.media) ? 'video' : 'image'}
                </span>
              </div>
            </Reveal>
          </div>
        </RecedeCard>
      ))}
      </div>
    </section>
  )
}
