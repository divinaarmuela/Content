import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { loadPublicService, availabilityFor } from '../../../../lib/booking'

/**
 * PUBLIC, unauthenticated: the open times for one bookable service.
 *
 * Deliberately tells a stranger nothing beyond what they need to pick a
 * time — no resource emails, no other customers, no hint whether a service
 * exists but is switched off.
 */
export async function GET(req: Request) {
 return withRequestCache(async () => {
  try {
    const url = new URL(req.url)
    const slug = String(url.searchParams.get('slug') ?? '').toLowerCase()
    const loaded = await loadPublicService(slug)
    if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const rawFrom = String(url.searchParams.get('from') ?? '')
    const today = new Date().toISOString().slice(0, 10)
    const from = /^\d{4}-\d{2}-\d{2}$/.test(rawFrom) && rawFrom >= today ? rawFrom : today
    const days = Number(url.searchParams.get('days')) || 14

    const availability = await availabilityFor(loaded.service, loaded.resources, from, days)
    const { id: _id, resource_id: _r, ...publicService } = loaded.service
    void _id; void _r
    return NextResponse.json({ service: publicService, from, availability })
  } catch (e) {
    console.error('public slots error:', e)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
 })
}
