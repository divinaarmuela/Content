import Link from 'next/link'
import { listPublicServices } from '../lib/booking'

export const dynamic = 'force-dynamic'

/** Everything bookable, in one shareable place. */
export default async function BookIndexPage() {
  const services = await listPublicServices()
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">Book a time</h1>
        <p className="max-w-prose text-sm leading-relaxed" style={{ opacity: 0.75 }}>
          Pick what you need and choose a slot that suits you.
        </p>
      </header>

      {services.length === 0 ? (
        <p className="border p-6 text-sm" style={{ borderColor: 'var(--bk-line)', opacity: 0.75 }}>
          Nothing is open for booking right now. Email{' '}
          <a href="mailto:contact@mdmmarketing.com.au" className="underline">contact@mdmmarketing.com.au</a>.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {services.map(s => (
            <li key={s.id}>
              <Link href={`/book/${s.slug}`}
                className="flex flex-col gap-1 border transition-opacity hover:opacity-75"
                style={{ borderColor: 'var(--bk-line)' }}>
                {s.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.image_url} alt={s.name} className="aspect-[21/9] w-full object-cover" />
                )}
                <span className="flex flex-col gap-1 p-5">
                <span className="text-lg font-medium tracking-tight">{s.name}</span>
                <span className="text-[11px] uppercase tracking-[0.16em]" style={{ opacity: 0.55 }}>
                  {s.duration_min} minutes
                  {s.price_cents > 0 ? ` · ${s.currency} $${(s.price_cents / 100).toFixed(2)}` : ' · Free'}
                  {s.location ? ` · ${s.location}` : ''}
                </span>
                {s.description && (
                  <span className="mt-1 text-sm leading-relaxed" style={{ opacity: 0.8 }}>{s.description}</span>
                )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
