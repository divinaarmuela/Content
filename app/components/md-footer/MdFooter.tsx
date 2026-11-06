import './md-footer.css'
import { archivo, sometype } from '../lama/fonts'

/** THE site footer — every public page uses this one (owner, 6 Nov 2026: one footer everywhere). It brings its own fonts so it looks the same on pages that do not load them. */
/** `bar` replaces the bottom line — each page's copy names its own. */
export default function MdFooter({ bar }: { bar?: React.ReactNode }) {
  return (
    <div role="contentinfo" className={`mdfoot ${archivo.variable} ${sometype.variable}`}>
      <div className="mdfoot-in">
        <div className="mdfoot-grid">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/MDLogo-trim.png" alt="MD Media" className="mdfoot-logo" />
            <p>Content-led marketing for founders and local businesses.</p>
          </div>
          <div>
            <p className="mdfoot-mono mdfoot-label">Explore</p>
            <a href="/work">Work</a><a href="/about">About</a><a href="/journal">Journal</a><a href="/events">Events</a>
          </div>
          <div>
            <p className="mdfoot-mono mdfoot-label">Services</p>
            <a href="/content">Content</a><a href="/marketing">Marketing</a><a href="/website">Website</a><a href="/campaign-shoots">Campaign shoots</a><a href="/podcast-bookings">Podcast bookings</a>
          </div>
          <div>
            <p className="mdfoot-mono mdfoot-label">Contact</p>
            <a href="mailto:hello@mdmmarketing.com.au">hello@mdmmarketing.com.au</a>
            <span>Melbourne · remote &amp; on location</span>
          </div>
          <div>
            <p className="mdfoot-mono mdfoot-label">Social</p>
            <a href="https://www.instagram.com/mdmedia._" target="_blank" rel="noreferrer noopener">Instagram</a>
            <a href="https://www.linkedin.com/company/mdmedia-marketing/" target="_blank" rel="noreferrer noopener">LinkedIn</a>
            <a href="https://www.tiktok.com/@mdmedia._" target="_blank" rel="noreferrer noopener">TikTok</a>
          </div>
        </div>
        <div className="mdfoot-bar mdfoot-mono">
          {bar ?? (
            <>
              <span>Australia · Est. 2024</span>
              <span>© MD Media, all rights reserved</span>
            </>
          )}
        </div>
        <p className="mdfoot-mono mdfoot-legal"><a href="/privacy">Privacy policy</a> · <a href="/terms">Terms of service</a> · <a href="/data-deletion">Data deletion</a></p>
      </div>
    </div>
  )
}
