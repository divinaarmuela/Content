'use client'

/**
 * Everything the studio needs about one booking, in one place.
 *
 * The list and the calendar both showed a name and nothing else — no email,
 * no phone, no notes. The phone number is REQUIRED at booking precisely so
 * somebody can be reached on the day, and it was being collected and then
 * hidden. Email and phone are real links: on a phone, tapping the number
 * calls it.
 */

export type BookingDetail = {
  id: string
  start_at: string
  end_at?: string | null
  customer_name: string
  customer_email?: string | null
  customer_phone?: string | null
  notes?: string | null
  public_ref?: string | null
  status: string
  payment_status?: string
  amount_cents?: number
  currency?: string
  booking_services: { name: string } | null
  booking_resources: { label: string } | null
}

const TZ = 'Australia/Melbourne'

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long',
    hour: 'numeric', minute: '2-digit',
  })

const timeOnly = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-AU', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })

const money = (c: number, cur = 'AUD') =>
  c === 0 ? 'Free' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: cur }).format(c / 100)

/** A phone number a browser will actually dial. */
const telHref = (p: string) => `tel:${p.replace(/[^\d+]/g, '')}`

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[12px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="text-body-15">{children}</span>
    </div>
  )
}

export default function BookingDetails({ booking }: { booking: BookingDetail }) {
  const b = booking
  return (
    <div className="grid gap-3 rounded-tile border border-border bg-foreground/[0.04] p-3 sm:grid-cols-2">
      <Field label="When">
        {when(b.start_at)}{b.end_at ? ` – ${timeOnly(b.end_at)}` : ''}
      </Field>
      <Field label="What">
        {b.booking_services?.name ?? 'Booking'}
        {b.booking_resources?.label ? <span className="text-muted-foreground"> · {b.booking_resources.label}</span> : null}
      </Field>

      <Field label="Who">{b.customer_name}</Field>
      <Field label="Email">
        {b.customer_email
          ? <a href={`mailto:${b.customer_email}`} className="underline-offset-4 hover:underline">{b.customer_email}</a>
          : <span className="text-muted-foreground">—</span>}
      </Field>

      <Field label="Phone">
        {b.customer_phone
          ? <a href={telHref(b.customer_phone)} className="underline-offset-4 hover:underline">{b.customer_phone}</a>
          : <span className="text-muted-foreground">not given</span>}
      </Field>
      <Field label="Payment">
        {b.payment_status === 'paid'
          ? <span className="text-foreground">Paid {money(b.amount_cents ?? 0, b.currency)}</span>
          : b.status === 'pending'
            ? <span className="text-foreground">Holding the slot — not paid yet</span>
            : <span className="text-muted-foreground">{money(b.amount_cents ?? 0, b.currency)} unpaid</span>}
      </Field>

      {b.public_ref && (
        <Field label="Reference"><span className="font-mono text-secondary-13">{b.public_ref}</span></Field>
      )}
      {b.notes && (
        <div className="sm:col-span-2">
          <Field label="What they told us">
            <span className="whitespace-pre-wrap text-muted-foreground">{b.notes}</span>
          </Field>
        </div>
      )}
    </div>
  )
}
