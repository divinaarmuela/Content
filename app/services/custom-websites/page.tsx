import type { Metadata } from 'next'
import ServicePage from '../../components/service-page/ServicePage'

export const metadata: Metadata = {
  title: 'Custom Websites — MD Media, Melbourne',
  description:
    'Fast, custom sites that look like your brand and are built to convert. Then we keep them running so they never go stale.',
  robots: 'index, follow',
  alternates: { canonical: 'https://www.mdmmarketing.com.au/services/custom-websites' },
  openGraph: {
    type: 'website',
    url: 'https://www.mdmmarketing.com.au/services/custom-websites',
    title: 'Custom Websites — MD Media',
    description: 'Your website is where most people decide whether to get in touch. We design every page to make that an easy yes.',
    siteName: 'MD Media Marketing',
    locale: 'en_AU',
  },
}

const V = '/videos/websites'

export default function CustomWebsitesPage() {
  return (
    <ServicePage
      current="websites"
      workFirst
      hero={{ image: '/images/websites/senorita-hero.jpg', device: 'laptop', label: 'Scrolling the Señorita Debutante website, built by MD Media' }}
      heroLink={{ href: 'https://www.senoritadebutante.com', label: 'Visit the site we built · senoritadebutante.com' }}
      lead="Your website is where most people decide whether to get in touch. We design every page to make that an easy yes. After launch, we handle the hosting, updates and fixes."
      body="Fast, custom sites that look like your brand and are built to convert. Then we keep them running so they never go stale."
      covered={[
        { title: 'Planning & structure', desc: 'Pages, journeys and the one action every visitor should take.' },
        { title: 'Copywriting', desc: 'Clear, direct words that explain what you do in seconds, written with sales psychology in mind to move visitors to enquire.' },
        { title: 'Custom design', desc: 'Designed in your brand. No templates.' },
        { title: 'Build & launch', desc: 'Fast, mobile-first, and easy for you to edit.' },
        { title: 'SEO foundations', desc: 'Clean structure, page titles and metadata, so the right people can find you.' },
        { title: 'Ongoing care', desc: 'Hosting, security, backups, updates and small content changes, handled every month.' },
        { title: 'SEO (optional)', desc: 'Ongoing keyword research, content and reporting to grow your search traffic over time.' },
      ]}
      steps={[
        ['Plan', 'Sitemap, user journeys and goals.'],
        ['Write', 'Copy for every page.'],
        ['Design', 'Custom layouts in your brand, built around the user experience.'],
        ['Build', 'Developed, tested and launched in 4 to 8 weeks.'],
        ['Care', 'Ongoing hosting, updates and optional SEO.'],
      ]}
      related={[
        { key: 'strategy', desc: 'Offers and messaging define what the site needs to say.' },
        { key: 'branding', desc: 'Your identity sets the design language.' },
        { key: 'content', desc: 'Photo and video from our shoots make the site feel real.' },
      ]}
      work={[
        { name: 'Señorita Debutante', href: 'https://www.senoritadebutante.com', builtSite: true, media: { video: `${V}/p4-senorita`, laptopImage: '/images/websites/senorita-hero.jpg', label: 'Señorita Debutante — website by MD Media, on a phone' }, desc: 'Brides-to-be fall for the gowns, then book a fitting in a few taps. A headless Next.js site, wired to Wix Bookings and Stores, so the team keeps managing dresses and appointments where they already work. GSAP and Three.js motion make every gown feel like an editorial.', stack: ['Next.js', 'React', 'TypeScript', 'Tailwind CSS', 'Wix Headless', 'Wix Bookings', 'Wix Stores', 'Wix CRM', 'GSAP', 'Locomotive Scroll', 'Motion', 'Three.js', 'Page transitions', 'Google Maps', 'Vitest'] },
        { name: 'Releeph', href: 'https://releeph.com.au', builtSite: true, media: { video: `${V}/p4-releeph`, laptopImage: '/images/websites/releeph-hero.jpg', label: 'Releeph — website by MD Media' }, desc: 'Launched as a custom build, then rebuilt as a headless Shopify store with cinematic campaign video front and centre. Behind it, Klaviyo EDM flows, a waitlist and one-off early-access links turn first visits into first orders, and a store-credit launch won back about 4,000 past customers.', stack: ['Next.js', 'React', 'TypeScript', 'Tailwind CSS', 'Shopify Storefront API', 'Shopify Admin API', 'Shopify customer accounts', 'Shopify webhooks', 'Klaviyo', 'Klaviyo EDM flows', 'GA4 custom pixel', 'GSAP', 'Lenis', 'View Transitions'] },
        { name: 'Capila Finance', href: 'https://capila.finance', builtSite: true, media: { video: `${V}/p4-capila`, laptopImage: '/images/websites/capila-hero.jpg', label: 'Capila Finance — website by MD Media' }, desc: 'A finance brand that looks the part, built to bring in leads. Every enquiry lands in GoHighLevel, tracked from first click to booked call. A 3D knight leads the homepage, and a private admin lets the team publish the journal and choose which Instagram and LinkedIn posts go live.', stack: ['Next.js', 'React', 'TypeScript', 'Tailwind CSS', 'GoHighLevel CRM', 'Lead tracking', 'Resend', 'Zernio social feed', 'Blog CMS + admin', 'Vercel Blob', 'Vercel Cron', 'React Three Fiber', 'drei', 'Lenis', 'Google Maps'] },
        { name: 'Alia Fragrance', href: 'https://aliafragrance.com', builtSite: true, media: { video: `${V}/p4-alia`, laptopImage: '/images/websites/alia-hero.jpg', label: 'Alia Fragrance — website by MD Media' }, desc: 'A fragrance house that opens with a hand-drawn animation and a scent finder that helps you choose before you’ve smelt a thing. Shopify runs the products and cart, and a Klaviyo waitlist with welcome flows builds the launch list before day one.', stack: ['Next.js', 'React', 'TypeScript', 'Tailwind CSS', 'Shopify', 'Shopify theme', 'Klaviyo', 'Klaviyo EDM flows', 'Three.js', 'OGL', 'Motion', 'Lenis', 'Canvas animation'] },
        { name: 'Jordan Wilson — Turnkey', href: 'https://jordan.turnkeygroup.au', builtSite: true, media: { video: `${V}/p4-jordan`, laptopImage: '/images/websites/jordan-hero.jpg', label: 'Jordan Wilson landing page — by MD Media, on a phone' }, desc: 'A personal-brand landing page for Turnkey Building Group’s builder broker, written to turn a first look into a discovery call booked straight into his calendar. Cinematic scroll, editorial photography and a private admin for edits.', stack: ['Next.js', 'React', 'TypeScript', 'Tailwind CSS', 'GSAP', 'Lenis', 'Three.js', 'Firebase', 'Acuity Scheduling', 'Vercel Analytics'] },
      ]}
      faqs={[
        ['How long does it take?', 'Usually 4 to 8 weeks from kickoff to launch, depending on the number of pages and how quickly we get feedback.'],
        ['Is it a template?', 'No. Every site is custom designed around your brand and how your customers use it, with the user experience planned before anything is built.'],
        ['What does ongoing care include?', 'Hosting, security monitoring, regular backups, software updates, speed checks and small content changes each month. If something breaks, we fix it.'],
        ['Do you offer SEO?', 'Every site launches with SEO foundations in place. Ongoing SEO is optional: keyword research, content updates and monthly reporting to grow your search traffic.'],
        ['Who owns the website?', 'You do. The site, the domain and the content are yours, whether you stay with us or not.'],
        ['Can I edit it myself?', 'Yes. We set it up so you can change text and images without calling us.'],
      ]}
    />
  )
}
