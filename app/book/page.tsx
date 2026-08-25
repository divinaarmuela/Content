import Link from 'next/link'
import { listPublicServices } from '../lib/booking'
import { serviceTeaser } from '../lib/booking-core'

export const dynamic = 'force-dynamic'

const price = (cents: number, currency: string) =>
  cents > 0
    ? `${currency === 'AUD' ? 'A$' : `${currency} `}${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    : 'Free'

const duration = (min: number) => {
  const h = Math.floor(min / 60); const m = min % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h} hour${h > 1 ? 's' : ''}`
  return `${m} min`
}

/**
 * Everything bookable, grouped by studio.
 *
 * A LIST, not nine brochures: each row gives the name, what it costs, how
 * long it takes and one line of why — the full inclusions live on the
 * service's own page, where someone who is actually interested will read
 * them. Printing all three sections against every row made the same
 * paragraph appear nine times.
 */
export default async function BookIndexPage() {
  const services = await listPublicServices()

  const groups: { name: string; items: typeof services }[] = []
  for (const s of services) {
    const name = s.category?.trim() || ''
    const g = groups.find(x => x.name === name)
    if (g) g.items.push(s)
    else groups.push({ name, items: [s] })
  }

  return (
    <div className="flex flex-col gap-14">
      <header className="flex flex-col gap-3">
        <p className="text-[11px] uppercase tracking-[0.22em]" style={{ opacity: 0.45 }}>Studio bookings</p>
        <h1 className="text-4xl font-medium leading-[1.05] tracking-tight sm:text-6xl">
          Book a session
        </h1>
        <p className="max-w-md text-sm leading-relaxed" style={{ opacity: 0.65 }}>
          Studio time, shoots and packages. Pick what you need, choose a time that suits you.
        </p>
      </header>

      {services.length === 0 ? (
        <p className="border p-6 text-sm" style={{ borderColor: 'var(--bk-line)', opacity: 0.75 }}>
          Nothing is open for booking right now. Email{' '}
          <a href="mailto:contact@mdmmarketing.com.au" className="underline text-inherit">contact@mdmmarketing.com.au</a>.
        </p>
      ) : groups.map((group, gi) => (
        <section key={group.name || gi} className="flex flex-col gap-6">
          {group.name && (
            <h2 className="text-[11px] uppercase tracking-[0.22em]" style={{ opacity: 0.45 }}>
              {group.name}
            </h2>
          )}

          <ul className="flex flex-col">
            {group.items.map((s, i) => {
              const teaser = serviceTeaser(s.description)
              return (
                <li key={s.id}>
                  <Link href={`/book/${s.slug}`}
                    className="group flex items-center gap-5 border-t py-5 transition-opacity hover:opacity-70 sm:gap-7"
                    style={{ borderColor: 'var(--bk-line)', borderTopWidth: i === 0 ? 1 : 1 }}>

                    {s.image_url ? (
                      /* contain, not cover: a thumbnail that crops is a
                         thumbnail that decapitates people */
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.image_url} alt="" aria-hidden
                        className="h-16 w-16 shrink-0 object-contain sm:h-20 sm:w-28"
                        style={{ background: 'rgba(249,244,235,0.04)' }} />
                    ) : (
                      <span aria-hidden className="hidden h-20 w-28 shrink-0 sm:block"
                        style={{ background: 'rgba(249,244,235,0.05)' }} />
                    )}

                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-base font-medium leading-snug tracking-tight sm:text-lg">
                        {s.name}
                      </span>
                      {teaser && (
                        <span className="line-clamp-1 text-[13px] leading-relaxed" style={{ opacity: 0.6 }}>
                          {teaser}
                        </span>
                      )}
                    </span>

                    <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                      <span className="text-base font-medium tabular-nums sm:text-lg">
                        {price(s.price_cents, s.currency)}
                      </span>
                      <span className="text-[11px] uppercase tracking-[0.12em]" style={{ opacity: 0.5 }}>
                        {duration(s.duration_min)}
                      </span>
                    </span>

                    <span aria-hidden className="hidden shrink-0 text-lg sm:block"
                      style={{ opacity: 0.35 }}>→</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      <footer className="border-t pt-6 text-[11px] leading-relaxed" style={{ borderColor: 'var(--bk-line)', opacity: 0.45 }}>
        Questions before you book? Email{' '}
        <a href="mailto:contact@mdmmarketing.com.au" className="underline text-inherit">contact@mdmmarketing.com.au</a>.
      </footer>
    </div>
  )
}
