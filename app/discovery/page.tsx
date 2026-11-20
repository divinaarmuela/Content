import type { Metadata, Viewport } from 'next'
import { archivo, sometype } from '../components/lama/fonts'
import DiscoveryStart from './DiscoveryStart'

export const metadata: Metadata = {
  title: 'Discovery form · MD Media',
  description: 'A few short questions before our first conversation.',
  robots: 'noindex, nofollow',
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

/**
 * THE DISCOVERY FORM'S ONE LINK (the owner, 20 Nov 2026: "this is cold send … one link for anyone"). The same address
 * goes into every cold email and message. Nothing is made by opening it — a link preview or a mail scanner opens
 * links too. Pressing Begin gives that visitor their own form and takes them to it.
 */
export default function DiscoveryPage() {
  return <div className={`${archivo.variable} ${sometype.variable}`}><DiscoveryStart /></div>
}
