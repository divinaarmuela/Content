import type { Metadata } from 'next'
import ManageFlow from './ManageFlow'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Your booking — MD Media',
  robots: 'noindex, nofollow',
}

/** /book/manage/<ref> — the link in a customer's confirmation email. */
export default async function ManageBookingPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params
  return <ManageFlow bookingRef={ref} />
}
