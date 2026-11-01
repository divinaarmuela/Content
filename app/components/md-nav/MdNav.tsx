import './md-nav.css'
import { sometype } from '../lama/fonts'

const CALENDLY = 'https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone?utm_source=website&utm_medium=book-a-call&utm_campaign=mdnav'

const SERVICES = [
  ['Strategy & Consulting', '/services/strategy'],
  ['Branding Suite', '/services/branding-suite'],
  ['Custom Websites', '/website'],
  ['Content & Visibility', '/services/content-visibility'],
  ['Campaign Shoots', '/campaign-shoots'],
] as const

/** The site's top bar on the Oct 2026 pages (homepage, service pages, campaign shoots). One component, so every page shows the same nav. */
export default function MdNav({ band = false }: { band?: boolean } = {}) {
  const nav = (
    <div role="navigation" aria-label="Main" className="mdnav">
      <a href="/" className="mdnav-mono">MD Media.</a>
      <div className="mdnav-links mdnav-mono">
        <div className="mdnav-drop">
          <a href="/#services" aria-haspopup="true">Services ▾</a>
          <div className="mdnav-menu">
            {SERVICES.map(([name, href]) => <a key={href} href={href}>{name}</a>)}
          </div>
        </div>
        <a href="/work">Work</a>
        <a href="/journal">Journal</a>
        <a href="/events">Events</a>
        <a href="/about">About</a>
        <a href="/#contact">Contact</a>
        <a href={CALENDLY} target="_blank" rel="noreferrer noopener" className="mdnav-cta">Book a call ↗</a>
      </div>
    </div>
  )
  // `band`: pages without a dark hero under the nav get a dark strip, so the light links stay readable.
  return band ? <div className={`mdnav-band ${sometype.variable}`}>{nav}</div> : nav
}
