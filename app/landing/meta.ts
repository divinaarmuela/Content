import type { Metadata } from 'next'

/** every /landing page: for ads only, so kept out of search and not in the menu (owner, 11 Nov 2026) */
export const landingMeta = (title: string, description: string): Metadata => ({
  title: `${title} — MD Media, Melbourne`,
  description,
  robots: 'noindex, nofollow',
})

/** the logo files we have (LogoWall's BRANDS, public/logos/content-visibility) */
export const ALL_LOGOS = [
  'Releeph', 'Alia Scents', 'Señorita Debutante Dresses', 'Park Noire', 'Hydra Wearables', 'DJI', 'Tilta', 'SmallRig',
  'Afterpay', 'HOKA', 'MoneyMe', 'Funday', 'Tixel', 'SkyBus', 'The Collagen Co.', 'One World Ecosolutions', 'Runway Room',
  'Shein Baby', 'Ellette', 'Sodii', 'Square', 'Somerset by Carter Grange', 'Real Deal', 'Cecconi’s', 'Intersign',
  'Bond St Dental', 'Kode Finance', 'Capra Financial Group', 'MGMT AUS', 'The Waterside', 'StretchWorks', 'Death & Co',
  'Imperial Hotel', 'Prahran Hotel', 'The Swan', 'Addicted to Audio',
]
