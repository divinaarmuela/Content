import type { Metadata } from 'next'
import ServicePage from '../../components/service-page/ServicePage'

export const metadata: Metadata = {
  title: 'Content & Visibility — MD Media, Melbourne',
  description:
    'Photo, video and social content that makes you look established and keeps you in front of the right audience, plus full campaign shoots from concept to delivery.',
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
      body="Photo, video, and social content that makes you look established and keeps you in front of the right audience, plus full campaign shoots from concept to delivery."
      covered={[
        { title: 'Content strategy', desc: 'Pillars, angles and a calendar built around your goals.' },
        { title: 'Photo & video production', desc: 'Produced by our in-house crew, on location or in studio.' },
        { title: 'Campaign shoots', desc: 'Concept to delivery, for launches, drops and seasons.', href: '/campaign-shoots' },
        { title: 'Founder content', desc: 'Building your personal brand alongside the business.' },
        { title: 'Social management', desc: 'Editing, captions, scheduling and community.' },
        { title: 'Reporting', desc: 'What’s working each month, and what we’ll do next.' },
      ]}
      steps={[
        ['Strategy', 'What to say, who it’s for, where it runs.'],
        ['Plan', 'Shot lists, scripts and a calendar.'],
        ['Shoot', 'Photo and video with our crew.'],
        ['Edit & post', 'Cut, captioned and scheduled.'],
        ['Review', 'Monthly reporting, then refine.'],
      ]}
      related={[
        { key: 'strategy', desc: 'Pillars and angles come from your positioning.' },
        { key: 'branding', desc: 'Every shoot is directed to the brand.' },
        { key: 'websites', desc: 'The same content keeps your site current.' },
      ]}
      work={[
        { name: 'Cecconi’s', href: 'https://cecconis.com', media: { video: `${V}/cecconis`, label: 'Cecconi’s — content by MD Media' } },
        { name: 'Waterside', href: 'https://watersidehotel.com.au', media: { video: `${V}/waterside`, label: 'Waterside — content by MD Media' } },
        { name: 'Park Noire', href: 'https://parknoire.com', media: { video: `${V}/park-noire`, label: 'Park Noire — content by MD Media' } },
      ]}
      faqs={[
        ['Do I have to be on camera?', 'Not always, but founder-led content usually performs best. We make it easy and coach you on the day.'],
        ['Do you post for us?', 'Yes. We can manage your channels end to end, or hand the content to your team.'],
      ]}
    />
  )
}
