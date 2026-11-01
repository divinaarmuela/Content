import type { Metadata } from 'next'
import ServicePage from '../../components/service-page/ServicePage'

export const metadata: Metadata = {
  title: 'Branding Suite — MD Media, Melbourne',
  description:
    'The full identity: how you look, how you sound, and how you’re remembered. Brand strategy, visual identity, tone of voice, guidelines and templates.',
  robots: 'index, follow',
  alternates: { canonical: 'https://www.mdmmarketing.com.au/services/branding-suite' },
  openGraph: {
    type: 'website',
    url: 'https://www.mdmmarketing.com.au/services/branding-suite',
    title: 'Branding Suite — MD Media',
    description: 'A brand is how people remember you when you’re not in the room.',
    siteName: 'MD Media Marketing',
    locale: 'en_AU',
  },
}

export default function BrandingSuitePage() {
  return (
    <ServicePage
      current="branding"
      hero={{ video: '/videos/branding-suite/hero', label: 'Señorita Debutante — the hero film from their website' }}
      lead="A brand is how people remember you when you’re not in the room. We build the whole system, so every touchpoint looks and sounds like the same business."
      body="The full identity: how you look, how you sound, and how you’re remembered. A strong brand makes your content, ads, and prices work harder."
      familiar={{
        heading: 'If people don’t remember you, don’t trust you on first look, or won’t pay your prices, the brand is usually the reason.',
        pairs: [
          ['Your Instagram, website, pitch deck and email signature all look like they belong to different businesses.', 'There’s no system. Every post, page and flyer gets made from scratch, so nothing feels like the same brand.'],
          ['Every new post or proposal means scrambling through Canva templates at the last minute.', 'Without proper templates and guidelines, each piece is a one-off. The result is patchy, rushed and off-brand, and it costs you time every week.'],
          ['People compare you on price.', 'Your brand doesn’t signal the quality of the work, so customers can’t see why you’re worth more.'],
          ['You’re embarrassed to send people to your site or socials.', 'The business has grown, but the brand is still from the early days.'],
          ['Your content and ads don’t land.', 'Without a clear look and voice, even good content gets scrolled past because it isn’t recognisable.'],
        ],
      }}
      covered={[
        { title: 'Brand strategy', desc: 'Personality, positioning and the story behind the business.' },
        { title: 'Visual identity', desc: 'Logo suite, colour, typography and art direction.' },
        { title: 'Tone of voice', desc: 'How you sound, written down so anyone can use it.' },
        { title: 'Brand guidelines', desc: 'The rules that keep everything consistent as you grow.' },
        { title: 'Templates & assets', desc: 'Social posts, pitch decks, proposals and email signatures, ready to use. No more last-minute Canva.' },
      ]}
      steps={[
        ['Discovery', 'Your story, audience, competitors and ambitions.'],
        ['Strategy', 'Positioning, personality and messaging.'],
        ['Identity', 'Visual directions, presented and discussed.'],
        ['Refine', 'We develop one direction into a full system.'],
        ['Rollout', 'Applied across your touchpoints, or handed to your team.'],
      ]}
      related={[
        { key: 'strategy', desc: 'We start from your positioning, or build it as part of the project.' },
        { key: 'websites', desc: 'Your new identity carries straight into a site built around it.' },
        { key: 'content', desc: 'Shoots are art-directed to the brand, so content is consistent from day one.' },
      ]}
      work={[
        // Photos from each brand's own site project (myProjects/Senorita, alia, capila); each card opens that brand's website.
        { name: 'Señorita Debutante', builtSite: true, href: 'https://www.senoritadebutante.com', media: { image: '/images/branding-suite/senorita.jpg', label: 'Two Señorita Debutante gowns under stone arches' } },
        { name: 'Alia', builtSite: true, href: 'https://aliafragrance.com', media: { image: '/images/branding-suite/alia.jpg', label: 'Two Alia bottles on red satin in their gift box' } },
        { name: 'Capila Finance', builtSite: true, href: 'https://capila.finance', media: { image: '/images/branding-suite/capila.jpg', label: 'A Capila Finance branded folio' } },
      ]}
      quote={{
        text: 'Their attention to detail, thorough planning, and strategic guidance made what could have been an overwhelming process feel incredibly organised and manageable.',
        who: 'Angelique Mangion, Beauty Blvd',
        tags: ['Brand redesign', 'Launch strategy', 'Content production'],
      }}
      logosTitle="Brands we’ve worked with"
      faqs={[
        ['Do you just design logos?', 'No. We build the whole identity, because a logo on its own doesn’t change how you’re seen.'],
        ['Can you refresh our brand rather than start again?', 'Yes. If there’s equity worth keeping, we evolve it rather than replace it.'],
        ['Will it work across everything we use?', 'Yes. We design the system for every touchpoint, from your website and socials to signage, packaging and presentations.'],
        ['What do you need from us?', 'Time for a discovery session, access to your current assets, and honest feedback at each stage. We handle the rest.'],
        ['Who owns the brand once it’s finished?', 'You do. The full set of logo files, fonts, colours and guidelines are handed over to keep.'],
      ]}
    />
  )
}
