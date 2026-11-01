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
      hero={{ video: `${V}/d-hero`, label: 'Scrolling the Señorita Debutante website, built by MD Media' }}
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
        { name: 'Señorita Debutante', href: 'https://www.senoritadebutante.com', builtSite: true, media: { video: `${V}/m-senorita`, label: 'Señorita Debutante — website by MD Media, on a phone' }, desc: 'Custom site for a debutante gown label. Clients browse gowns and shoot galleries and book fittings online; the team still manages dresses and appointments in Wix.', stack: ['Next.js', 'React', 'TypeScript', 'Tailwind CSS', 'Wix Headless', 'Wix Bookings', 'Wix Stores', 'Wix CRM', 'GSAP', 'Locomotive Scroll', 'Motion', 'Three.js', 'Page transitions', 'Google Maps', 'Vitest'] },
        { name: 'Releeph', href: 'https://releeph.com.au', builtSite: true, media: { video: `${V}/m-releeph`, label: 'Releeph — website by MD Media' }, desc: 'Started as a custom build, then moved onto Shopify as a headless store. 3D sky visuals, an ad landing page, early-access links per customer, Klaviyo waitlist and email flows, and a store-credit launch for past customers.', stack: ['Next.js', 'React', 'TypeScript', 'Tailwind CSS', 'Shopify Storefront API', 'Shopify Admin API', 'Shopify customer accounts', 'Shopify webhooks', 'Klaviyo', 'Klaviyo EDM flows', 'GA4 custom pixel', 'React Three Fiber', 'Post-processing', 'GSAP', 'Lenis', 'Vanta', 'View Transitions'] },
        { name: 'Capila Finance', href: 'https://capila.finance', builtSite: true, media: { video: `${V}/m-capila`, label: 'Capila Finance — website by MD Media' }, desc: 'Finance brokerage site with a 3D hero. Enquiries go straight into GoHighLevel for lead tracking, and a private admin lets the team write the journal and choose which Instagram and LinkedIn posts appear.', stack: ['Next.js', 'React', 'TypeScript', 'Tailwind CSS', 'GoHighLevel CRM', 'Lead tracking', 'Resend', 'Zernio social feed', 'Blog CMS + admin', 'Vercel Blob', 'Vercel Cron', 'React Three Fiber', 'drei', 'Lenis', 'Google Maps'] },
        { name: 'Alia Fragrance', href: 'https://aliafragrance.com', builtSite: true, media: { video: `${V}/m-alia`, label: 'Alia Fragrance — website by MD Media' }, desc: 'Pre-launch site for a fragrance house: an animated hand-drawn intro, a scent finder, Shopify products and cart, and a Klaviyo waitlist with email flows for early sign-ups.', stack: ['Next.js', 'React', 'TypeScript', 'Tailwind CSS', 'Shopify', 'Shopify theme', 'Klaviyo', 'Klaviyo EDM flows', 'Three.js', 'OGL', 'Motion', 'Lenis', 'Canvas animation'] },
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
