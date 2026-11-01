import './logo-wall.css'

/**
 * "Brands we've created content for" — on every page that wants it, one list, one look.
 * Logos extracted from the Content & Visibility PDF (31 Oct 2026), white on transparent,
 * in /public/logos/content-visibility, one file per brand named by `logoFile`.
 */
export const BRANDS = [
  'Releeph', 'Alia Scents', 'Señorita Debutante Dresses', 'Park Noire', 'Hydra Wearables', 'DJI', 'Tilta',
  'SmallRig', 'Afterpay', 'HOKA', 'MoneyMe', 'Funday', 'Tixel', 'SkyBus', 'The Collagen Co.',
  'One World Ecosolutions', 'Runway Room', 'Shein Baby', 'Ellette', 'Sodii', 'Square',
  'Somerset by Carter Grange', 'Real Deal', 'Cecconi’s', 'Intersign', 'Bond St Dental', 'Kode Finance',
  'Capra Financial Group', 'MGMT AUS', 'The Waterside', 'StretchWorks', 'Death & Co', 'Imperial Hotel',
  'Skinny Dog Hotel', 'Prahran Hotel', 'Quarterhouse', 'The Swan', 'The Provincial',
  'Studley Park Boathouse', 'Public House', 'Prince Alfred', 'Richmond Club Hotel', 'Addicted to Audio',
]

export const logoFile = (b: string) =>
  b.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** `textOnly`: brands with no logo file yet, shown as their name. `tone="light"`: dark logos on a light background. */
export default function LogoWall({
  title = 'Brands we’ve created content for',
  className,
  brands = BRANDS,
  textOnly = [],
  tone = 'dark',
  hideTitle = false,
}: { title?: string; className?: string; brands?: string[]; textOnly?: string[]; tone?: 'dark' | 'light'; hideTitle?: boolean }) {
  return (
    <section className={`logowall${tone === 'light' ? ' logowall-light' : ''}${className ? ` ${className}` : ''}`} aria-label={title}>
      {!hideTitle && <h2 className="logowall-title">{title}</h2>}
      <ul className="logowall-list">
        {brands.map(b => (
          <li key={b}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/logos/content-visibility/${logoFile(b)}.png`} alt={b} loading="lazy" />
          </li>
        ))}
        {textOnly.map(b => <li key={b} className="logowall-text">{b}</li>)}
      </ul>
    </section>
  )
}
