import { NextResponse } from 'next/server'
import { listPublicServices } from '../../../../lib/booking'
import { serviceTeaser } from '../../../../lib/booking-core'

/**
 * PUBLIC: everything bookable, for a booking section embedded on any page.
 *
 * Ids and the delivering resource stay server-side — a stranger gets the
 * name, what it costs, how long it takes and where it sits in the list.
 */
export async function GET() {
  try {
    const services = await listPublicServices()
    return NextResponse.json({
      services: services.map(s => ({
        name: s.name,
        slug: s.slug,
        category: s.category,
        duration_min: s.duration_min,
        price_cents: s.price_cents,
        currency: s.currency,
        image_url: s.image_url,
        location: s.location,
        teaser: serviceTeaser(s.description),
      })),
    })
  } catch (e) {
    console.error('public services error:', e)
    return NextResponse.json({ services: [] })
  }
}
