import type { Metadata } from 'next'
import ServicePage from '../../components/service-page/ServicePage'

export const metadata: Metadata = {
  title: 'Content & Visibility — MD Media, Melbourne',
  description:
    'Photo and video content that makes you look established, shot to your brand and built around your promotional campaigns. From one-off shoots to full campaign production, concept to delivery.',
  robots: 'index, follow',
  alternates: { canonical: 'https://www.mdmmarketing.com.au/services/content-visibility' },
  openGraph: {
    type: 'website',
    url: 'https://www.mdmmarketing.com.au/services/content-visibility',
    title: 'Content & Visibility — MD Media',
    description: 'Visibility is the foundation. Content is how people find you, understand you and start to trust you.',
    siteName: 'MD Media Marketing',
    locale: 'en_AU',
  },
}

const V = '/videos/content-visibility'

export default function ContentVisibilityPage() {
  return (
    <ServicePage
      current="content"
      // Death & Co, not Quarterhouse (Divina, 2 Nov 2026: "please use this video not the quarterhouse"); the Quarterhouse
      // clip stays at `${V}/hero` for its own card on the Work page
      hero={{ video: `${V}/hero-death-co`, label: 'Death & Co — content by MD Media' }}
      lead="Visibility is the foundation. Content is how people find you, understand you and start to trust you before they ever reach out."
      // THE PAGE COPY OF 2 NOV 2026 (Divina's "Content Visibility - Copy.md" and its PDF mock): content production only —
      // no social management, no reporting, no posting. Paid Advertising is in the copy's "bigger picture" but has no page
      // yet, so it is left out until there is one to link to.
      body="Photo and video content that makes you look established, shot to your brand and built around your promotional campaigns. From one-off shoots to full campaign production, concept to delivery."
      covered={[
        { title: 'Creative direction', desc: 'Concepts, mood and shot lists built from your brand guidelines and the campaign you’re running.' },
        { title: 'Photo & video production', desc: 'Produced by our in-house crew, on location or in studio.' },
        { title: 'Campaign shoots', desc: 'Concept to delivery, for launches, drops and seasons.', href: '/campaign-shoots' },
        { title: 'Founder content', desc: 'Building your personal brand alongside the business.' },
        { title: 'Editing & delivery', desc: 'Retouched images and edited video, cut for every format and channel you use.' },
      ]}
      steps={[
        ['Brief', 'Your brand, your campaign and where the content will run.'],
        ['Plan', 'Concepts, shot lists, scripts and casting.'],
        ['Shoot', 'Photo and video with our crew.'],
        ['Edit', 'Retouched, cut and graded to your brand.'],
        ['Deliver', 'A ready-to-use library, sized for every format.'],
      ]}
      related={[
        { key: 'strategy', desc: 'Angles and messaging come from your positioning.' },
        { key: 'branding', desc: 'Every shoot is directed to your brand guidelines.' },
        { key: 'websites', desc: 'The same content keeps your site current.' },
      ]}
      work={[
        { name: 'Cecconi’s', href: '/work/cecconis', media: { video: `${V}/cecconis`, label: 'Cecconi’s — content by MD Media' } },
        { name: 'Waterside', href: '/work/waterside', media: { video: `${V}/waterside`, label: 'Waterside — content by MD Media' } },
        { name: 'Park Noire', href: '/work/park-noire', media: { video: `${V}/park-noire`, label: 'Park Noire — content by MD Media' } },
      ]}
      logosTitle="Brands we’ve created content for"
      faqs={[
        ['Do I have to be on camera?', 'Not always, but founder-led content usually performs best. We make it easy and coach you on the day.'],
        ['Do you post or manage our socials?', 'No. This service is content production only. We deliver the finished library ready for your team, or your social manager, to post.'],
        ['Will it match our brand and campaigns?', 'Yes. Every shoot is planned from your brand guidelines and the campaign it’s for, and we lock the creative direction with you before shoot day.'],
      ]}
    />
  )
}
