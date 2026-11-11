import LandingPage from '../LandingPage'
import { ALL_LOGOS, landingMeta } from '../meta'

export const metadata = landingMeta('Custom Websites', 'Custom websites built to turn visits into enquiries, then looked after every month.')

const V = '/videos/websites'
export default function Page() {
  return <LandingPage d={{
    slug: 'custom-websites',
    headline: <>A website that turns visits into <em>enquiries</em>.</>,
    lead: 'Your website is where most people decide whether to get in touch. We design every page to make that an easy yes, then handle the hosting, updates and fixes after launch.',
    hero: { video: `${V}/p4-senorita`, label: 'The Señorita Debutante website, built by MD Media, on a phone' },
    ctas: ['Explore your options', 'See what your site could do', 'Plan your new website', 'Start the conversation'],
    note: 'Free · 10 minutes · no obligation',
    logos: ALL_LOGOS,
    workHeading: 'Sites we’ve built.',
    work: [
      { name: 'Señorita Debutante', kind: 'Bridal & debutante gowns', href: 'https://www.senoritadebutante.com', line: 'Brides-to-be fall for the gowns, then book a fitting in a few taps. A headless Next.js site, wired to Wix Bookings and Stores, so the team keeps managing dresses and appointments where they already work.', media: { video: `${V}/p4-senorita`, label: 'Señorita Debutante website on a phone' } },
      { name: 'Releeph', kind: 'Wellness ecommerce', href: 'https://releeph.com.au', line: 'Rebuilt as a headless Shopify store with cinematic campaign video front and centre. Klaviyo flows, a waitlist and early-access links turn first visits into first orders, and a store-credit launch won back about 4,000 past customers.', media: { video: `${V}/p4-releeph`, label: 'Releeph website on a phone' } },
      { name: 'Capila Finance', kind: 'Finance', href: 'https://capila.finance', line: 'A finance brand that looks the part, built to bring in leads. Every enquiry lands in GoHighLevel, tracked.', media: { video: `${V}/p4-capila`, label: 'Capila Finance website on a phone' } },
      { name: 'Alia Fragrance', kind: 'Fragrance', href: 'https://aliafragrance.com', line: 'A fragrance house that opens with a hand-drawn animation and a scent finder that helps you choose.', media: { video: `${V}/p4-alia`, label: 'Alia Fragrance website on a phone' } },
    ],
    included: {
      heading: 'Everything from plan to launch, then looked after.',
      items: [
        { title: 'Planning & structure', desc: 'Pages, journeys and the one action every visitor should take.' },
        { title: 'Copywriting', desc: 'Clear, direct words that explain what you do in seconds, written to move visitors to enquire.' },
        { title: 'Custom design', desc: 'Designed in your brand. No templates.' },
        { title: 'Build & launch', desc: 'Fast, mobile-first, and easy for you to edit.' },
        { title: 'SEO foundations', desc: 'Clean structure, page titles and metadata, so the right people can find you.' },
        { title: 'Ongoing care', desc: 'Hosting, security, backups, updates and small content changes, handled every month.' },
      ],
    },
    strip: [
      { src: '/images/websites/senorita-tile', alt: 'Señorita Debutante website' },
      { src: `${V}/p4-releeph`, alt: 'Releeph website' },
      { src: `${V}/p4-capila`, alt: 'Capila Finance website' },
      { src: `${V}/p4-alia`, alt: 'Alia Fragrance website' },
      { src: `${V}/p4-jordan`, alt: 'Jordan Wilson landing page' },
      { src: `${V}/p4-senorita`, alt: 'Señorita Debutante on a phone' },
    ],
    steps: [
      ['Plan', 'Sitemap, user journeys and goals.'],
      ['Write', 'Copy for every page.'],
      ['Design', 'Custom layouts in your brand, built around the user experience.'],
      ['Build', 'Developed, tested and launched in 4 to 8 weeks.'],
      ['Care', 'Ongoing hosting, updates and optional SEO.'],
    ],
    faqs: [
      ['How long does it take?', 'Usually 4 to 8 weeks from kickoff to launch, depending on the number of pages and how quickly we get feedback.'],
      ['Is it a template?', 'No. Every site is custom designed around your brand and how your customers use it.'],
      ['What does ongoing care include?', 'Hosting, security monitoring, regular backups, software updates, speed checks and small content changes each month. If something breaks, we fix it.'],
      ['Who owns the website?', 'You do. The site, the domain and the content are yours, whether you stay with us or not.'],
    ],
  }} />
}
