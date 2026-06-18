import type { Metadata } from 'next'
import 'lenis/dist/lenis.css'
import './globals.css'

export const metadata: Metadata = {
  title: 'MD Media Marketing — Melbourne Growth Agency',
  description:
    "Melbourne's end-to-end growth agency. Brand strategy, content production, and ongoing marketing built as one system.",
  robots: 'index, follow, max-image-preview:large',
  icons: {
    icon: '/favicon.svg',
  },
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'ProfessionalService',
      '@id': 'https://www.mdmmarketing.com.au/#organization',
      name: 'MD Media Marketing',
      alternateName: 'MD Media',
      description:
        'Melbourne-based creative studio producing photography, video, and copy for Australian businesses.',
      url: 'https://www.mdmmarketing.com.au',
      logo: 'https://static.wixstatic.com/media/c5a69a_eb5dd45dbca445798fa310acb86c4420~mv2.png',
      email: 'hello@mdmmarketing.com.au',
      telephone: '+61447764477',
      priceRange: '$$$',
      foundingDate: '2024',
      founder: [
        { '@type': 'Person', name: 'Divina Armuela', jobTitle: 'Co-Founder & Managing Director' },
        { '@type': 'Person', name: 'Martin Kormushoski', jobTitle: 'Co-Founder & Creative Director' },
      ],
      address: {
        '@type': 'PostalAddress',
        streetAddress: '56/21-25 Chambers Rd',
        addressLocality: 'Altona North',
        addressRegion: 'VIC',
        postalCode: '3025',
        addressCountry: 'AU',
      },
      areaServed: [
        { '@type': 'Country', name: 'Australia' },
        { '@type': 'City', name: 'Melbourne' },
        { '@type': 'City', name: 'Sydney' },
        { '@type': 'City', name: 'Brisbane' },
      ],
      sameAs: [
        'https://www.instagram.com/mdmedia._',
        'https://www.linkedin.com/company/mdmedia-marketing/',
        'https://www.tiktok.com/@mdmedia._',
        'https://youtube.com/@mdmediapodcast',
      ],
    },
    {
      '@type': 'WebPage',
      url: 'https://www.mdmmarketing.com.au/',
      name: 'Content Production & Creative Assets — MD Media, Melbourne',
      description:
        'Photography, video, and copy engineered to convert. Monthly subscription or project-based production.',
      inLanguage: 'en-AU',
      isPartOf: { '@id': 'https://www.mdmmarketing.com.au/#website' },
      about: { '@id': 'https://www.mdmmarketing.com.au/#organization' },
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://www.mdmmarketing.com.au/' },
        { '@type': 'ListItem', position: 2, name: 'Services', item: 'https://www.mdmmarketing.com.au/' },
        {
          '@type': 'ListItem',
          position: 3,
          name: 'Content Production',
          item: 'https://www.mdmmarketing.com.au/',
        },
      ],
    },
    {
      '@type': 'Service',
      serviceType: 'Content Production & Creative Assets',
      name: 'Content That Converts',
      description:
        'Professional photography, video production, and copywriting. Available as a monthly content subscription or as project-based productions.',
      provider: { '@id': 'https://www.mdmmarketing.com.au/#organization' },
      areaServed: [{ '@type': 'Country', name: 'Australia' }],
      hasOfferCatalog: {
        '@type': 'OfferCatalog',
        name: 'Content Services',
        itemListElement: [
          {
            '@type': 'Offer',
            itemOffered: {
              '@type': 'Service',
              name: 'Content Subscription',
              description:
                'Monthly content production package. Recurring shoots, consistent editing, predictable output across every channel.',
            },
          },
          {
            '@type': 'Offer',
            itemOffered: {
              '@type': 'Service',
              name: 'Project Production',
              description:
                'One-off productions: campaigns, launches, brand films, event coverage, large-scale shoots.',
            },
          },
        ],
      },
    },
    {
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: "What's the difference between subscription and project?",
          acceptedAnswer: {
            '@type': 'Answer',
            text: "Subscription is recurring monthly content built for ongoing output. Project-based is one-off: campaigns, launches, brand films, or big productions with a defined start and end. Most businesses run both, subscription for the always-on feed, project when something specific needs to happen.",
          },
        },
        {
          '@type': 'Question',
          name: 'Do you shoot everything in-house?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: "Yes. Every shoot is produced by our in-house team. Same crew every time. No rotating freelancers, no outsourced editing, no quality drift between months.",
          },
        },
        {
          '@type': 'Question',
          name: 'Can you travel for shoots?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: "Yes. We shoot across Australia. Travel and logistics are scoped per project. Melbourne is home base, but the crew gets on planes regularly.",
          },
        },
        {
          '@type': 'Question',
          name: 'Who owns the raw files?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: "You own every final deliverable forever. Raw footage policy is scoped per engagement, some subscriptions include raw selects, larger projects include full raw delivery.",
          },
        },
        {
          '@type': 'Question',
          name: 'Do you write scripts and captions too?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: "Yes. Copy is part of production, not an afterthought. Hooks, scripts, captions, and on-screen text are all written by the team that shoots and edits the work.",
          },
        },
        {
          '@type': 'Question',
          name: "What's the minimum engagement for subscription?",
          acceptedAnswer: {
            '@type': 'Answer',
            text: "Three months. Month one plans and produces, month two delivers and learns, month three refines and scales. After that, it's month-to-month.",
          },
        },
      ],
    },
  ],
}

import SiteShell from './components/SiteShell'
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});


export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
      <html lang="en" className={cn("font-sans", geist.variable)}>
        <head>
          <link rel="preconnect" href="https://static.wixstatic.com" />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link
            href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter+Tight:wght@400;500;600&display=swap"
            rel="stylesheet"
          />
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
          />
        </head>
        <body>
          <SiteShell>{children}</SiteShell>
        </body>
      </html>
  )
}
