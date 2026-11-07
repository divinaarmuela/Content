/**
 * The Work page's client list, grouped by sector (Oct 2026 design).
 *
 * Lives in code for now so the page can be reviewed on localhost before the
 * projects table gains `sector` / `current` columns. Clients with a case study
 * are matched to the CMS by `slug`; everyone else is a name and a cover.
 *
 * `media`: a loop (`.mp4` + `.jpg` poster, no extension) or an image path.
 * Missing media renders a labelled empty frame, never a stock picture.
 */
export type SectorClient = {
  name: string
  slug?: string // has a case study at /work/{slug}
  current?: boolean
  desc?: string
  media?: { video?: string; image?: string }
}

export type Sector = {
  n: string
  name: string
  tags: string[]
  clients: SectorClient[]
  /** names still to be supplied by the owner */
  missing?: number
}

export const SECTORS: Sector[] = [
  {
    n: '01',
    name: 'Finance & Property',
    tags: ['Founder brand', 'Content system', 'Paid'],
    // Finance & property clients from the dashboard's client list (Diamond Lending is Capila Finance, so it is listed once).
    clients: [
      { name: 'Real Deal Property', slug: 'real-deal', current: true, media: { image: '/images/strategy/real-deal.jpg' } },
      { name: 'Capila Finance', media: { image: '/images/branding-suite/capila.jpg' } },
      { name: 'Atelier Realty' },
      { name: 'Elixir Wealth Advisory' },
      { name: 'EvolveIN Accounting' },
    ],
  },
  {
    n: '02',
    name: 'Trades & Logistics',
    tags: ['Positioning', 'B2B content', 'Founder led'],
    clients: [
      { name: 'Intersign', slug: 'intersign', current: true, desc: 'Brand positioning and content for a trade business ready to move upmarket. B2B content that speaks to builders, architects, and developers.', media: { image: '/images/strategy/intersign.jpg' } },
      { name: 'Prowall' },
      { name: 'BuildOne' },
      { name: 'Arko Joinery' },
    ],
  },
  {
    n: '03',
    name: 'Clinics & Health',
    tags: ['Brand', 'Content', 'Bookings'],
    clients: [
      { name: 'Luxe Laser & Skin Solutions' },
      { name: 'StretchWorks', slug: 'stretchworks', desc: 'A studio that left a franchise system and lost the brand it traded under. We rebuilt the positioning, messaging and content behind it.', media: { video: '/videos/strategy/stretchworks' } },
      { name: 'Beauty Boulevard' },
      { name: 'Bond Street Dental', media: { image: '/images/work/bond-street.jpg' } },
    ],
  },
  {
    n: '04',
    name: 'Hospitality',
    tags: ['Editorial photography', 'Campaigns', 'Venues & events'],
    clients: [
      // its clip (/videos/work/emerald) was Releeph footage, not the venue (owner, 7 Nov 2026) — no media until a real Emerald clip exists
      { name: 'The Emerald — Reception venue', current: true },
      { name: 'Cecconi’s Toorak & Flinders Street', slug: 'cecconis', desc: 'Editorial photography and content for two of Melbourne’s most recognised fine dining venues. Visual storytelling that earns reservations.', media: { video: '/videos/content-visibility/cecconis' } },
      { name: 'Death & Co Melbourne — CBD', media: { video: '/videos/work/death-co' } },
      { name: 'Quarterhouse — Docklands', media: { video: '/videos/content-visibility/hero' } },
      { name: 'Studley Park Boathouse', media: { video: '/videos/work/studley' } },
      { name: 'Imperial Hotel — Bourke St', media: { image: '/images/work/imperial.jpg' } },
      { name: 'The Provincial — Fitzroy', media: { video: '/videos/work/provincial' } },
      { name: 'Swan Hotel', media: { video: '/videos/work/swan' } },
      { name: 'Public House Richmond', media: { video: '/videos/work/public-house' } },
      { name: 'Richmond Club Hotel' },
      { name: 'Waterside Hotel', slug: 'waterside', desc: 'Documenting Melbourne’s most ambitious pub redevelopment from the ground up.', media: { video: '/videos/content-visibility/waterside' } },
    ],
  },
  {
    n: '05',
    name: 'Product & Retail',
    tags: ['Brand identity', 'Launch', 'Shoot production'],
    clients: [
      { name: 'Releeph', slug: 'releeph', current: true, desc: 'Brand and campaign work for a product launch. Identity, content, and the story that carries a physical product into market.', media: { video: '/videos/campaign-shoots/hero-portrait' } },
      { name: 'Alia Scents', slug: 'alia-fragrance', current: true, desc: 'A fragrance brand launching from zero. We built the go-to-market and put the founders inside the brand story rather than behind it.', media: { image: '/images/branding-suite/alia.jpg' } },
      { name: 'Basfoods', current: true, media: { video: '/videos/work/basfoods' } },
      { name: 'Senorita Debutante Dresses', slug: 'senorita-debutante', current: true, desc: 'Zero to fully booked. Brand identity, shoot production, and a content strategy that made it the most wanted dress seller in Melbourne.', media: { video: '/videos/branding-suite/hero' } },
      { name: 'Addicted to Audio — via BusiSoft' },
      { name: 'Park Noire', slug: 'park-noire', desc: 'Building a menswear label’s visual world from the ground up, while growing the founder’s personal brand alongside it.', media: { video: '/videos/content-visibility/park-noire' } },
      { name: 'Insieme' },
    ],
  },
]

/** The count beside each sector: what the design states, including clients still to be named. */
export const sectorCount = (s: Sector) => s.clients.length + (s.missing ?? 0)
