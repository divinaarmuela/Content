export type WorkClient = {
  slug: string
  name: string
  industry: string
  services: string[]
  desc: string
  img: string
  tag: string
  result?: string
  /** case study body — challenge / approach / outcome */
  study: {
    challenge: string[]
    approach: string[]
    outcome: string[]
  }
}

export const clients: WorkClient[] = [
  {
    slug: 'pattons',
    name: 'Pattons',
    industry: 'Hospitality',
    services: ['Content Production', 'Social Media Management', 'Brand Photography'],
    desc: 'Monthly content production and social management for a Melbourne hospitality institution. Consistent visual identity across all platforms.',
    img: 'c5a69a_8ff71d938a1447a1b0987a2bb9272b1c~mv2.jpg',
    tag: 'HOSp_01',
    study: {
      challenge: [
        'An established Melbourne hospitality name with a loyal in-person following — and an online presence that didn’t reflect it. Posting was sporadic, the visual style shifted from month to month, and the feed undersold the actual experience of being there.',
      ],
      approach: [
        'We moved Pattons onto a monthly production rhythm: one shoot day covering food, space, and people, feeding a pre-planned calendar across Instagram and Facebook. A tight visual system — consistent grading, recurring formats, a recognisable voice in captions — so every post is unmistakably theirs.',
        'Social management sits with the same team that shoots, so what performs directly shapes what gets produced next month.',
      ],
      outcome: [
        'A feed that finally matches the room: consistent, recognisable, and always current. The venue stays visible between visits, and the brand reads as established at first glance — because online, first glance is where the booking decision starts.',
      ],
    },
  },
  {
    slug: 'cecconis',
    name: "Cecconi's Toorak & Flinders",
    industry: 'Fine Dining',
    services: ['Brand Photography', 'Content Production', 'Paid Ads'],
    desc: "Editorial photography and content for two of Melbourne's most recognised fine dining venues. Visual storytelling that earns reservations.",
    img: 'c5a69a_cb9a54ad31dd4061b2e52c45e33cd36c~mv2.jpg',
    tag: 'REST_02',
    study: {
      challenge: [
        'Two venues with serious reputations and standards to match. The content had to sit at the same level as the plates — editorial, not "restaurant social media" — while still shipping consistently across both locations.',
      ],
      approach: [
        'Editorial photography treated as brand work: considered light, real service moments, dishes shot the way the kitchen intends them. Production covers both venues in coordinated cycles so each keeps its own character within one recognisable standard.',
        'The strongest organic work then runs as paid — putting the best of the brand in front of the diners most likely to book.',
      ],
      outcome: [
        'Visual storytelling that earns reservations rather than likes. The content holds the brand’s standard across every touchpoint a diner checks before booking — and the ads work harder because the creative was never an afterthought.',
      ],
    },
  },
  {
    slug: 'waterside',
    name: 'Waterside',
    industry: 'Venue & Events',
    services: ['Ongoing Marketing', 'Content Production', 'Meta Ads'],
    desc: 'Full marketing retainer for a Melbourne waterfront venue. Strategy, production, and performance advertising working as one system.',
    img: '/waterside-poster.jpg',
    tag: 'VENUE_03',
    study: {
      challenge: [
        'A waterfront venue competing for functions, events, and weekend trade — three different audiences, one brand. Marketing had been handled piecemeal, with content, ads, and strategy living in separate hands.',
      ],
      approach: [
        'A full retainer with everything under one roof: quarterly strategy, monthly production, and always-on Meta campaigns built from the organic work. Function enquiries, event promotion, and general trade each get their own content lane and their own campaign logic.',
        'One team seeing the whole funnel means the shoot list is written from what the ads need, and the ads run on creative that actually looks like the venue.',
      ],
      outcome: [
        'Strategy, production, and performance advertising working as one system rather than three vendors. The venue shows up consistently across every channel a function-booker checks, with performance data feeding each month’s production.',
      ],
    },
  },
  {
    slug: 'park-noire',
    name: 'Park Noire',
    industry: 'Hospitality & Nightlife',
    services: ['Brand Strategy', 'Visual Identity', 'Content Production'],
    desc: 'End-to-end brand strategy and content for a boutique Melbourne venue. Identity built around atmosphere, not just aesthetics.',
    img: 'c5a69a_301debe79d924d1485598c4f5f601013~mv2.jpg',
    tag: 'VENUE_04',
    study: {
      challenge: [
        'A boutique venue entering a crowded nightlife market where most brands look interchangeable: dark room, neon accent, same fonts. Park Noire needed an identity people could feel before they’d ever visited.',
      ],
      approach: [
        'Strategy before design: who the room is for, what a night there feels like, and what the brand should promise. The visual identity was built from atmosphere — texture, light, and mood carried consistently from the logo through to every frame of content.',
        'Ongoing production keeps the world coherent: every photo and clip is shot inside the same visual language the identity established.',
      ],
      outcome: [
        'A venue brand with a point of view — recognisable in a feed full of lookalikes, and consistent from the signage to the stories. The identity does what nightlife brands rarely manage: it sets an expectation the room then keeps.',
      ],
    },
  },
  {
    slug: 'intersign',
    name: 'Intersign',
    industry: 'Signage & Trade',
    services: ['Brand Strategy', 'Content Production', 'Digital Presence'],
    desc: 'Brand positioning and content for a trade business ready to move upmarket. B2B content that speaks to builders, architects, and developers.',
    img: 'c5a69a_142a963c514f4e789ed0b63123dfd7af~mv2.jpg',
    tag: 'TRADE_05',
    study: {
      challenge: [
        'A capable trade business whose presentation said "small operator" while its work said otherwise. To win builders, architects, and developers, the brand had to look like a company those clients could confidently specify.',
      ],
      approach: [
        'Repositioning first: leading with capability, process, and finished projects rather than price. Then content built for a B2B audience — project documentation, install photography, and the kind of proof that decision-makers forward to each other.',
        'The digital presence was rebuilt to match: a coherent identity across the site and socials, so every touchpoint supports the upmarket move instead of undermining it.',
      ],
      outcome: [
        'A trade brand that presents at the level of the clients it wants. The work now looks like what it is — and enquiries increasingly come from the builders and developers the repositioning was aimed at.',
      ],
    },
  },
  {
    slug: 'senorita-debutante',
    name: 'Senorita Debutante',
    industry: 'Fashion & Events',
    services: ['Brand Identity', 'Content Production', 'Social Media'],
    desc: 'Zero to fully booked. Brand identity, shoot production, and a content strategy that turned a fashion debut into a sold-out events calendar.',
    img: 'c5a69a_6f5585879dda4f0fa31d352ce2e612cb~mv2.jpg',
    tag: 'FASH_06',
    result: '0 → 30 bookings / day',
    study: {
      challenge: [
        'A brand-new fashion and events business with no audience, no identity, and a calendar to fill. Everything had to be built from zero — and quickly enough for the launch to land.',
      ],
      approach: [
        'Identity, content, and distribution built together instead of in sequence: a distinctive visual world designed for social from day one, launch shoots produced before the doors opened, and a posting strategy engineered to compound rather than spike.',
        'Every piece of content pointed at one action — booking — with the social presence doing the work of a sales team the business didn’t have yet.',
      ],
      outcome: [
        'From a standing start to roughly thirty bookings a day at peak, and a sold-out events calendar. The launch proved the model: when identity and content are built as one system, a new brand can look established from its first week.',
      ],
    },
  },
]

// ─── Projects from Divina's handoff not previously on the site ───
// img values are PLACEHOLDERS (existing generic shots) — swap for real
// project assets when they land in /public.
clients.push(
  {
    slug: 'releeph',
    name: 'Releeph',
    industry: 'Product',
    services: ['Brand Strategy', 'Content Production', 'Campaign'],
    desc: 'Brand and campaign work for a product launch. Identity, content, and the story that carries a physical product into market.',
    img: '/im2.jpg', // PLACEHOLDER
    tag: 'PROD_07',
    study: {
      challenge: [
        'A physical product entering a market where the difference is felt in the hand — which is exactly what a feed can’t do. The brand had to communicate texture, quality, and intent through a screen.',
      ],
      approach: [
        'Brand strategy and campaign built together: positioning the product around the problem it quietly solves, then producing launch content that shows the product in real use rather than on a white background.',
        'Campaign assets were designed as a system — hero film, cutdowns, stills, and social formats all from one production cycle.',
      ],
      outcome: [
        'A product brand with a coherent world around it from day one: launch content, campaign assets, and an identity that scales past the first release. Full campaign detail published once final results are confirmed with the client.',
      ],
    },
  },
  {
    slug: 'alia-fragrance',
    name: 'Alia Fragrance',
    industry: 'Fragrance & Beauty',
    services: ['Brand Identity', 'Launch Strategy', 'Content Production'],
    desc: 'Brand and launch for a fragrance house. Building desire for a product the internet can’t smell.',
    img: '/im3.jpg', // PLACEHOLDER
    tag: 'FRAG_08',
    study: {
      challenge: [
        'Fragrance is the hardest product to sell online — the one thing that matters can’t travel through the screen. Everything around the scent has to do the persuading: the world, the imagery, the story.',
      ],
      approach: [
        'An identity built on mood and material — light, texture, and art direction that suggest what the fragrance feels like. Launch content produced as a single coherent campaign across social, email, and the site, so the brand arrives fully formed rather than assembling itself in public.',
      ],
      outcome: [
        'A fragrance brand whose presence does the sensory work the screen can’t. Launch timing and results to be published once confirmed with the client.',
      ],
    },
  },
  {
    slug: 'the-real-deal',
    name: 'The Real Deal',
    industry: 'Media',
    services: ['Content System', 'Production', 'Distribution'],
    desc: 'A content system for a media brand: recurring formats, batched production, and distribution built for compounding.',
    img: '/im4.jpg', // PLACEHOLDER
    tag: 'MEDIA_09',
    study: {
      challenge: [
        'A media brand lives or dies on output — but output without a system means burnout or quality drift, usually both. The Real Deal needed a machine, not a content calendar.',
      ],
      approach: [
        'Recurring formats designed first, so every episode and clip slots into a recognisable structure the audience learns to expect. Production batched around those formats, with a distribution layer that cuts every recording into platform-native pieces.',
      ],
      outcome: [
        'A content system that ships consistently without heroics: formats the audience recognises, production the team can sustain, and distribution that makes each recording work several times over.',
      ],
    },
  },
  {
    slug: 'stretchworks',
    name: 'Stretchworks',
    industry: 'Health & Wellness',
    services: ['Content Production', 'Social Media', 'Brand Photography'],
    desc: 'Content for a health and wellness studio: real practitioners, real clients, and a presence that builds trust before the first visit.',
    img: '/DSC01591.jpg', // PLACEHOLDER
    tag: 'HLTH_10',
    study: {
      challenge: [
        'In health and wellness, the product is trust. Stock photography and generic wellness clichés actively undermine it — people want to see the actual practitioners and the actual space before they book a first session.',
      ],
      approach: [
        'Documentary-style content: real sessions, real practitioners explaining what they do, and photography of the studio as it actually is. A publishing cadence built around education — content that answers the questions people have before they’re ready to book.',
      ],
      outcome: [
        'A presence that lowers the barrier to the first visit: prospective clients arrive already familiar with the space, the faces, and the method. Trust built in the feed, converted in the studio.',
      ],
    },
  },
)

export const getClient = (slug: string) => clients.find(c => c.slug === slug)

export const wixImg = (id: string, w: number, h: number) =>
  id.startsWith('/')
    ? id
    : `https://static.wixstatic.com/media/${id}/v1/fill/w_${w},h_${h},al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/${id}`
