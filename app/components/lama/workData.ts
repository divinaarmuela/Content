export type WorkClient = {
  name: string
  industry: string
  services: string[]
  desc: string
  img: string
  tag: string
  result?: string
}

export const clients: WorkClient[] = [
  {
    name: 'Pattons',
    industry: 'Hospitality',
    services: ['Content Production', 'Social Media Management', 'Brand Photography'],
    desc: 'Monthly content production and social management for a Melbourne hospitality institution. Consistent visual identity across all platforms.',
    img: 'c5a69a_8ff71d938a1447a1b0987a2bb9272b1c~mv2.jpg',
    tag: 'HOSp_01',
  },
  {
    name: "Cecconi's Toorak & Flinders",
    industry: 'Fine Dining',
    services: ['Brand Photography', 'Content Production', 'Paid Ads'],
    desc: "Editorial photography and content for two of Melbourne's most recognised fine dining venues. Visual storytelling that earns reservations.",
    img: 'c5a69a_cb9a54ad31dd4061b2e52c45e33cd36c~mv2.jpg',
    tag: 'REST_02',
  },
  {
    name: 'Waterside',
    industry: 'Venue & Events',
    services: ['Ongoing Marketing', 'Content Production', 'Meta Ads'],
    desc: 'Full marketing retainer for a Melbourne waterfront venue. Strategy, production, and performance advertising working as one system.',
    img: 'c5a69a_4bc1ab98c0674462a67fea672a7a3d2a~mv2.jpg',
    tag: 'VENUE_03',
  },
  {
    name: 'Chantal Cutter',
    industry: 'Finance / Personal Brand',
    services: ['Personal Brand', 'Content Production', 'LinkedIn Strategy'],
    desc: 'Personal brand build for a Melbourne finance operator. Voice positioning, monthly shoots, and a content system that generates qualified inbound leads.',
    img: 'c5a69a_ad4957b0df6b4257b3a20ac240a39348~mv2.jpg',
    tag: 'FIN_04',
    result: '2 → 12 leads / month',
  },
  {
    name: 'Park Noire',
    industry: 'Hospitality & Nightlife',
    services: ['Brand Strategy', 'Visual Identity', 'Content Production'],
    desc: 'End-to-end brand strategy and content for a boutique Melbourne venue. Identity built around atmosphere, not just aesthetics.',
    img: 'c5a69a_301debe79d924d1485598c4f5f601013~mv2.jpg',
    tag: 'VENUE_05',
  },
  {
    name: 'Intersign',
    industry: 'Signage & Trade',
    services: ['Brand Strategy', 'Content Production', 'Digital Presence'],
    desc: 'Brand positioning and content for a trade business ready to move upmarket. B2B content that speaks to builders, architects, and developers.',
    img: 'c5a69a_142a963c514f4e789ed0b63123dfd7af~mv2.jpg',
    tag: 'TRADE_06',
  },
  {
    name: 'Senorita Debutante',
    industry: 'Fashion & Events',
    services: ['Brand Identity', 'Content Production', 'Social Media'],
    desc: 'Zero to fully booked. Brand identity, shoot production, and a content strategy that turned a fashion debut into a sold-out events calendar.',
    img: 'c5a69a_6f5585879dda4f0fa31d352ce2e612cb~mv2.jpg',
    tag: 'FASH_07',
    result: '0 → 30 bookings / day',
  },
]

export const wixImg = (id: string, w: number, h: number) =>
  `https://static.wixstatic.com/media/${id}/v1/fill/w_${w},h_${h},al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/${id}`
