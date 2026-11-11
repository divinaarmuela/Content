import LandingPage from '../LandingPage'
import { ALL_LOGOS, landingMeta } from '../meta'

export const metadata = landingMeta('Content & Visibility', 'Photo and video content that makes you look established, shot to your brand and your campaigns.')

const V = '/videos/content-visibility'
export default function Page() {
  return <LandingPage d={{
    slug: 'content-visibility',
    headline: <>Content that makes you look <em>established</em>.</>,
    lead: 'Content is how people find you, understand you and start to trust you before they ever reach out. Photo and video shot to your brand and built around your campaigns.',
    hero: { video: `${V}/hero-death-co`, label: 'Death & Co — content by MD Media', shape: 'landscape' },
    ctas: ['Explore your options', 'See what we’d shoot for you', 'Plan your next shoot', 'Start the conversation'],
    note: 'Free · 10 minutes · no obligation',
    logos: ALL_LOGOS,
    workHeading: 'Content we’ve made.',
    work: [
      { name: 'Cecconi’s', kind: 'Fine dining', href: '/work/cecconis', media: { video: `${V}/cecconis`, label: 'Cecconi’s — content by MD Media' } },
      { name: 'The Waterside', kind: 'Venue & events', href: '/work/waterside', media: { video: `${V}/waterside`, label: 'The Waterside — content by MD Media' } },
      { name: 'Park Noire', kind: 'Fashion', href: '/work/park-noire', media: { video: `${V}/park-noire`, label: 'Park Noire — content by MD Media' } },
      { name: 'Death & Co', kind: 'Cocktail bar', media: { video: `${V}/hero`, label: 'Content by MD Media', shape: 'landscape' } },
    ],
    included: {
      heading: 'From concept to a finished library.',
      items: [
        { title: 'Creative direction', desc: 'Concepts, mood and shot lists built from your brand guidelines and the campaign you’re running.' },
        { title: 'Photo & video production', desc: 'Produced by our in-house crew, on location or in studio.' },
        { title: 'Campaign shoots', desc: 'Concept to delivery, for launches, drops and seasons.' },
        { title: 'Founder content', desc: 'Building your personal brand alongside the business.' },
        { title: 'Editing & delivery', desc: 'Retouched images and edited video, cut for every format and channel you use.' },
      ],
    },
    strip: [
      { src: `${V}/cecconis`, alt: 'Cecconi’s' },
      { src: `${V}/waterside`, alt: 'The Waterside' },
      { src: `${V}/park-noire`, alt: 'Park Noire' },
      { src: `${V}/hero-death-co`, alt: 'Death & Co' },
      { src: `${V}/hero`, alt: 'MD Media content' },
    ],
    steps: [
      ['Brief', 'Your brand, your campaign and where the content will run.'],
      ['Plan', 'Concepts, shot lists, scripts and casting.'],
      ['Shoot', 'Photo and video with our crew.'],
      ['Edit', 'Retouched, cut and graded to your brand.'],
      ['Deliver', 'A ready-to-use library, sized for every format.'],
    ],
    faqs: [
      ['Do I have to be on camera?', 'Not always, but founder-led content usually performs best. We make it easy and coach you on the day.'],
      ['Do you post or manage our socials?', 'This service is content production. We deliver the finished library ready for your team, or your social manager, to post.'],
      ['Will it match our brand and campaigns?', 'Yes. Every shoot is planned from your brand guidelines and the campaign it’s for, and we lock the creative direction with you before shoot day.'],
    ],
  }} />
}
