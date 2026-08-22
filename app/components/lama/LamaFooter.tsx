import { Scramble } from './Scramble'

const COLS: { label: string; links: { href: string; text: string; ext?: boolean }[] }[] = [
  {
    label: '[ SERVICES ]',
    links: [
      { href: '/content', text: 'Content Production' },
      { href: '/marketing', text: 'Ongoing Marketing' },
      { href: '/branding', text: 'Brand & Strategy' },
    ],
  },
  {
    label: '[ STUDIO ]',
    links: [
      { href: '/work', text: 'Our Work' },
      { href: '/about', text: 'About' },
      { href: '/journal', text: 'Journal' },
      { href: '/events', text: 'The Room' },
    ],
  },
  {
    label: '[ CONNECT ]',
    links: [
      { href: 'https://www.instagram.com/mdmedia._', text: 'Instagram +', ext: true },
      { href: 'https://www.linkedin.com/company/mdmedia-marketing/', text: 'LinkedIn +', ext: true },
      { href: 'https://www.tiktok.com/@mdmedia._', text: 'TikTok +', ext: true },
      { href: 'mailto:hello@mdmmarketing.com.au', text: 'hello@mdmmarketing.com.au' },
    ],
  },
]

/** Dark-world footer for the lama-styled pages (homepage system): charcoal
 *  ink, cream type, hairline rules, scramble labels. Content mirrors
 *  SiteFooter so no destination is lost between the two worlds. */
export default function LamaFooter({ vol }: { vol: string }) {
  return (
    <footer className="!bg-ink !border-t !border-cream/15 !p-0">
      <div className="px-6 sm:px-10 py-14 sm:py-16">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-10 sm:grid-cols-[minmax(0,1.4fr)_1fr_1fr_1fr]">
            <div>
              <a href="/" className="no-underline" aria-label="MD Media home">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/MDLogo-trim.png" alt="MD Media" className="h-6 w-auto" />
              </a>
              <p className="mt-5 font-lamah text-cream-dim text-sm leading-relaxed max-w-[26ch]">
                Get seen. Get known. Get booked.
              </p>
            </div>
            {COLS.map(col => (
              <div key={col.label} className="flex flex-col gap-3">
                <Scramble text={col.label} gate={false} className="font-lamam text-[10px] uppercase tracking-widest text-cream-faint" />
                {col.links.map(l => (
                  <a
                    key={l.text}
                    href={l.href}
                    {...(l.ext ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
                    className="font-lamah text-cream/80 visited:text-cream/80 text-sm no-underline hover:text-accent transition-colors w-fit"
                  >
                    {l.text}
                  </a>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-12 border-t border-cream/15 pt-5 flex flex-wrap justify-between gap-3 font-lamam text-[10px] uppercase tracking-widest text-cream-faint">
            <span>© 2026 MD Media Marketing Pty Ltd · ABN 75 681 730 512</span>
            <span>{vol}</span>
            <span>Melbourne, Australia</span>
          </div>
        </div>
      </div>
    </footer>
  )
}
