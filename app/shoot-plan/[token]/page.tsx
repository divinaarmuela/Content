import type { Metadata } from 'next'
import { loadSharedShoot } from '../../lib/shoot-share'
import SharedShootView from './SharedShootView'

/**
 * THE SHOOT PLAN, FOR ANYBODY HOLDING THE LINK (shoot-share-core; the owner, 23 Nov 2026: "we need a public available
 * link for this … this is not a client portal"). No sign-in: middleware.ts protects a short list and this is not on
 * it, on purpose. The brief, each script with the comments made on its words, the board when there is one, and the
 * rest of the thread. Nothing is editable and nothing links into the dashboard.
 */
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Shoot plan — MD Media', robots: { index: false, follow: false } }

export default async function ShootPlanPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <SharedShootView shoot={await loadSharedShoot(decodeURIComponent(token))} />
}
