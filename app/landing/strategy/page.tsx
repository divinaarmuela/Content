import LandingPage from '../LandingPage'
import { ALL_LOGOS, landingMeta } from '../meta'

export const metadata = landingMeta('Strategy & Consulting', 'Positioning, offers and a marketing roadmap. Work out what you should be known for, then what to build first.')

export default function Page() {
  return <LandingPage d={{
    slug: 'strategy',
    headline: <>Get known for the <em>right</em> thing.</>,
    lead: 'Most marketing problems are positioning problems. We work out what you should be known for, fix your offers, and map what to build first.',
    hero: { video: '/videos/strategy/hero-bts', label: 'Behind the scenes on a campaign shoot with the MD Media team' },
    ctas: ['Explore your options', 'See where you could grow', 'Plan your next move', 'Talk it through with us'],
    note: 'Free · 10 minutes · no obligation',
    logos: ALL_LOGOS,
    problems: {
      heading: 'If you’re not getting the right customers, it’s rarely the marketing. It’s what sits underneath it.',
      pairs: [
        ['You’re getting enquiries, but from the wrong people.', 'Your positioning is too broad. When you speak to everyone, the people you actually want don’t see themselves in it.'],
        ['People love what you do, but won’t pay what it’s worth.', 'Your offer isn’t packaged or priced to show its value, so you end up competing on price.'],
        ['You’re posting and advertising, but no one’s paying attention.', 'Your message sounds like everyone else’s in your market, so there’s no reason to stop and look.'],
        ['You’re busy, but the business isn’t growing.', 'There’s no plan connecting the work, so effort goes out but nothing compounds.'],
      ],
    },
    workHeading: 'Brands we’ve sharpened.',
    work: [
      { name: 'StretchWorks', kind: 'Health & wellness', href: 'https://www.stretchworks.com.au', media: { video: '/videos/strategy/stretchworks', label: 'StretchWorks — stretch coach in studio', shape: 'landscape' } },
      { name: 'Intersign', kind: 'Signage, seen at the Australian Open', href: '/work/intersign', media: { image: '/images/strategy/intersign.jpg', label: 'Intersign — signage at the Australian Open' } },
      { name: 'Real Deal', kind: 'Property', href: 'https://www.realdealproperty.com.au', media: { image: '/images/strategy/real-deal.jpg', label: 'Real Deal Property founders' } },
    ],
    included: {
      heading: 'What we work out with you.',
      items: [
        { title: 'Positioning & messaging', desc: 'Who you’re for, what makes you different, and the words that say it.' },
        { title: 'Offer & pricing', desc: 'How your services are packaged and priced, so they’re easy to understand and buy.' },
        { title: 'Market & competitor audit', desc: 'Where you sit in your market, what others are doing, and the gaps you can own.' },
        { title: 'Marketing roadmap', desc: 'A prioritised plan across brand, web, content and paid, with clear next steps.' },
        { title: 'Advisory', desc: 'Ongoing check-ins as you build, for founders who want a sounding board.' },
      ],
    },
    strip: [
      { src: '/images/strategy/team', alt: 'The MD Media team' },
      { src: '/images/strategy/intersign', alt: 'Intersign at the Australian Open' },
      { src: '/videos/strategy/hero-bts', alt: 'Behind the scenes on a shoot' },
      { src: '/images/strategy/real-deal', alt: 'Real Deal Property founders' },
      { src: '/videos/strategy/stretchworks', alt: 'StretchWorks in studio' },
    ],
    steps: [
      ['Listen', 'Where the business is, where you want it to go, and what’s in the way.'],
      ['Audit', 'Brand, offers, numbers, channels and competitors.'],
      ['Define', 'Positioning, messaging and offer structure.'],
      ['Plan', 'A roadmap of what to do, in what order.'],
      ['Build or hand over', 'We deliver it with you, or hand you the playbook.'],
    ],
    faqs: [
      ['Can you build it too, or just plan it?', 'Both. Most clients have us deliver it with them, but some take the playbook and run it in-house.'],
      ['Is strategy a one-off?', 'It can be. Most clients start with a strategy project, then keep us on for advisory or delivery.'],
    ],
  }} />
}
