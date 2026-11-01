import './md-footer.css'

/** The site footer on the Oct 2026 pages (homepage, service pages). One component, so every page shows the same footer. */
/** `bar` replaces the bottom line — each page's copy names its own. */
export default function MdFooter({ bar }: { bar?: React.ReactNode }) {
  return (
    <div role="contentinfo" className="mdfoot">
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
      </div>
    </div>
  )
}
