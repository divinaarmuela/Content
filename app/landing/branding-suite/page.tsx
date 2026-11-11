import LandingPage from '../LandingPage'
import { ALL_LOGOS, landingMeta } from '../meta'

export const metadata = landingMeta('Branding Suite', 'The whole brand system, so every touchpoint looks and sounds like the same business.')

export default function Page() {
  return <LandingPage d={{
    slug: 'branding-suite',
    headline: <>A brand people <em>remember</em>.</>,
    lead: 'A brand is how people remember you when you’re not in the room. We build the whole system, so every touchpoint looks and sounds like the same business.',
    hero: { video: '/videos/branding-suite/hero', label: 'Señorita Debutante — the hero film from their website', shape: 'landscape' },
    ctas: ['Explore your options', 'See what your brand could be', 'Start the conversation', 'Explore a rebrand'],
    note: 'Free · 10 minutes · no obligation',
    logos: ALL_LOGOS,
    problems: {
      heading: 'If people don’t remember you, or won’t pay your prices, the brand is usually the reason.',
      pairs: [
        ['Your Instagram, website and pitch deck look like different businesses.', 'There’s no system. Every post, page and flyer gets made from scratch, so nothing feels like the same brand.'],
        ['Every new post or proposal means scrambling through Canva.', 'Without proper templates and guidelines, each piece is a one-off: patchy, rushed and off-brand, and it costs you time every week.'],
        ['People compare you on price.', 'Your brand doesn’t signal the quality of the work, so customers can’t see why you’re worth more.'],
        ['You’re embarrassed to send people to your site or socials.', 'The business has grown, but the brand is still from the early days.'],
      ],
    },
    workHeading: 'Brands we’ve built.',
    work: [
      { name: 'Señorita Debutante', kind: 'Bridal & debutante gowns', href: 'https://www.senoritadebutante.com', media: { image: '/images/branding-suite/senorita.jpg', label: 'Two Señorita Debutante gowns under stone arches' } },
      { name: 'Alia', kind: 'Fragrance', href: 'https://aliafragrance.com', media: { image: '/images/branding-suite/alia.jpg', label: 'Two Alia bottles on red satin in their gift box' } },
      { name: 'Capila Finance', kind: 'Finance', href: 'https://capila.finance', media: { image: '/images/branding-suite/capila.jpg', label: 'A Capila Finance branded folio' } },
      { name: 'Releeph', kind: 'Wellness, the Slow Mornings campaign', href: 'https://releeph.com.au', media: { video: '/videos/campaign-shoots/hero-portrait', label: 'Releeph Slow Mornings campaign, shot by MD Media' } },
    ],
    included: {
      heading: 'The whole system, not just a logo.',
      items: [
        { title: 'Brand strategy', desc: 'Personality, positioning and the story behind the business.' },
        { title: 'Visual identity', desc: 'Logo suite, colour, typography and art direction.' },
        { title: 'Tone of voice', desc: 'How you sound, written down so anyone can use it.' },
        { title: 'Brand guidelines', desc: 'The rules that keep everything consistent as you grow.' },
        { title: 'Templates & assets', desc: 'Social posts, pitch decks, proposals and email signatures, ready to use. No more last-minute Canva.' },
      ],
    },
    strip: [
      { src: '/images/branding-suite/senorita', alt: 'Señorita Debutante gowns' },
      { src: '/images/branding-suite/alia', alt: 'Alia fragrance' },
      { src: '/videos/branding-suite/hero', alt: 'Señorita Debutante film' },
      { src: '/images/branding-suite/capila', alt: 'Capila Finance folio' },
      { src: '/videos/campaign-shoots/hero-portrait', alt: 'Releeph campaign' },
    ],
    steps: [
      ['Discovery', 'Your story, audience, competitors and ambitions.'],
      ['Strategy', 'Positioning, personality and messaging.'],
      ['Identity', 'Visual directions, presented and discussed.'],
      ['Refine', 'We develop one direction into a full system.'],
      ['Rollout', 'Applied across your touchpoints, or handed to your team.'],
    ],
    quote: { text: 'Their attention to detail, thorough planning, and strategic guidance made what could have been an overwhelming process feel incredibly organised and manageable.', who: 'Angelique Mangion, Beauty Blvd' },
    faqs: [
      ['Do you just design logos?', 'No. We build the whole identity, because a logo on its own doesn’t change how you’re seen.'],
      ['Can you refresh our brand rather than start again?', 'Yes. If there’s equity worth keeping, we evolve it rather than replace it.'],
      ['Will it work across everything we use?', 'Yes. We design the system for every touchpoint, from your website and socials to signage, packaging and presentations.'],
      ['Who owns the brand once it’s finished?', 'You do. The full set of logo files, fonts, colours and guidelines are handed over to keep.'],
    ],
  }} />
}
