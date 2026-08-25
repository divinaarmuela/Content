import Link from 'next/link'
import { listPublicServices } from '../lib/booking'
import ServiceCopy from '../components/booking/ServiceCopy'

export const dynamic = 'force-dynamic'

const price = (cents: number, currency: string) =>
  cents > 0 ? `${currency === 'AUD' ? 'A$' : ''}${(cents / 100).toFixed(2)}` : 'Free'

const duration = (min: number) => {
  const h = Math.floor(min / 60); const m = min % 60
  if (h && m) return `${h} hr ${m} min`
  if (h) return `${h} hr`
  return `${m} min`
}

/** Everything bookable, grouped by studio — the same shape people already
 *  know from the current booking site. */
export default async function BookIndexPage() {
  const services = await listPublicServices()

  // preserve sort_order within a studio, and studio order by first appearance
  const groups: { name: string; items: typeof services }[] = []
  for (const s of services) {
    const name = s.category?.trim() || 'Services'
    const g = groups.find(x => x.name === name)
    if (g) g.items.push(s)
    else groups.push({ name, items: [s] })
  }

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-3">
        <h1 className="text-4xl font-medium tracking-tight sm:text-5xl">Book a session</h1>
        <p className="max-w-prose text-sm leading-relaxed" style={{ opacity: 0.7 }}>
          Studio time, shoots and packages. Pick what you need and choose a slot that suits you.
        </p>
      </header>

      {services.length === 0 ? (
        <p className="border p-6 text-sm" style={{ borderColor: 'var(--bk-line)', opacity: 0.75 }}>
          Nothing is open for booking right now. Email{' '}
          <a href="mailto:contact@mdmmarketing.com.au" className="underline">contact@mdmmarketing.com.au</a>.
        </p>
      ) : groups.map(group => (
        <section key={group.name} className="flex flex-col gap-5">
          <h2 className="border-b pb-2 text-lg font-medium tracking-tight" style={{ borderColor: 'var(--bk-line)' }}>
            {group.name}
          </h2>

          <ul className="flex flex-col gap-4">
            {group.items.map(s => (
              <li key={s.id}>
                <Link href={`/book/${s.slug}`}
                  className="group flex gap-5 border p-4 transition-colors sm:p-5"
                  style={{ borderColor: 'var(--bk-line)' }}>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <span className="text-base font-medium tracking-tight sm:text-lg">{s.name}</span>
                    <span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em]"
                      style={{ opacity: 0.6, fontFamily: 'var(--font-sometype), monospace' }}>
                      <span>{price(s.price_cents, s.currency)}</span>
                      <span style={{ opacity: 0.5 }}>·</span>
                      <span>{duration(s.duration_min)}</span>
                    </span>
                    {/* first two blocks only — the full detail is on the page */}
                    <div className="line-clamp-3">
                      <ServiceCopy copy={s.description} compact />
                    </div>
                    <span className="mt-1 text-[11px] uppercase tracking-[0.14em] underline-offset-4 group-hover:underline"
                      style={{ fontFamily: 'var(--font-sometype), monospace' }}>
                      Book this →
                    </span>
                  </div>

                  {s.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.image_url} alt={s.name}
                      className="h-24 w-24 shrink-0 object-cover sm:h-28 sm:w-36" />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
