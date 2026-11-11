import type { Metadata } from 'next'
import ServicePage from '../../components/service-page/ServicePage'

export const metadata: Metadata = {
  title: 'Strategy & Consulting — MD Media, Melbourne',
  description:
    'Positioning, offers and a marketing roadmap. We work out what you should be known for, then decide what to build first.',
  robots: 'index, follow',
  alternates: { canonical: 'https://www.mdmmarketing.com.au/services/strategy' },
  openGraph: {
    type: 'website',
    url: 'https://www.mdmmarketing.com.au/services/strategy',
    title: 'Strategy & Consulting — MD Media',
    description: 'Most marketing problems are positioning problems.',
    siteName: 'MD Media Marketing',
    locale: 'en_AU',
  },
}

export default function StrategyPage() {
  return (
    <ServicePage
      current="strategy"
      hero={{ video: '/videos/strategy/hero-bts', label: 'Behind the scenes on a campaign shoot with the MD Media team' }}
      heroSide
      lead="Most marketing problems are positioning problems. Strategy is where we work out what you should be known for, then decide what to build first."
      body="We sharpen your positioning, fix your offers, and map the path from where you are to where you want to be. Then we build it, or hand you the playbook."
      familiar={{
        heading: 'If you’re not getting the right customers, clients or attention, it’s rarely the marketing. It’s what sits underneath it.',
        pairs: [
          ['You’re getting enquiries, but from the wrong people.', 'Your positioning is too broad. When you speak to everyone, the people you actually want don’t see themselves in it.'],
          ['People love what you do, but won’t pay what it’s worth.', 'Your offer isn’t packaged or priced to show its value, so you end up competing on price.'],
          ['You’re posting and advertising, but no one’s paying attention.', 'Your message sounds like everyone else’s in your market, so there’s no reason to stop and look.'],
          ['You’re busy, but the business isn’t growing.', 'There’s no plan connecting the work, so effort goes out but nothing compounds.'],
        ],
      }}
      covered={[
        { title: 'Positioning & messaging', desc: 'Who you’re for, what makes you different, and the words that say it.' },
        { title: 'Offer & pricing', desc: 'How your services are packaged and priced, so they’re easy to understand and buy.' },
        { title: 'Market & competitor audit', desc: 'Where you sit in your market, what others are doing, and the gaps you can own.' },
        { title: 'Marketing roadmap', desc: 'A prioritised plan across brand, web, content and paid, with clear next steps.' },
        { title: 'Advisory', desc: 'Ongoing check-ins as you build, for founders who want a sounding board.' },
      ]}
      steps={[
        ['Listen', 'Where the business is, where you want it to go, and what’s in the way.'],
        ['Audit', 'Brand, offers, numbers, channels and competitors.'],
        ['Define', 'Positioning, messaging and offer structure.'],
        ['Plan', 'A roadmap of what to do, in what order.'],
        ['Build or hand over', 'We deliver it with you, or hand you the playbook.'],
      ]}
      related={[
        { key: 'branding', desc: 'Your positioning becomes the brief for your identity.' },
        { key: 'websites', desc: 'Messaging and offers shape the site’s structure and copy.' },
        { key: 'content', desc: 'Strategy sets the pillars and angles your content is built on.' },
      ]}
      work={[
        { name: 'StretchWorks', href: 'https://www.stretchworks.com.au', media: { video: '/videos/strategy/stretchworks', label: 'StretchWorks — stretch coach in studio' } },
        { name: 'Intersign', href: '/work/intersign', media: { image: '/images/strategy/intersign.jpg', label: 'Intersign — signage at the Australian Open' } },
        { name: 'Real Deal', href: 'https://www.realdealproperty.com.au', media: { image: '/images/strategy/real-deal.jpg', label: 'Real Deal Property founders' } },
      ]}
      faqs={[
        ['Can you build it too, or just plan it?', 'Both. Most clients have us deliver it with them, but some take the playbook and run it in-house.'],
        ['Is strategy a one-off?', 'It can be. Most clients start with a strategy project, then keep us on for advisory or delivery.'],
      ]}
    />
  )
}
