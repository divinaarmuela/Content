import FooterLogo from './FooterLogo'

/** Homepage-style footer, shared across the service pages. */
export default function SiteFooter({ vol, tagline }: { vol: string; tagline?: React.ReactNode }) {
  return (
    <footer>
      <div className="container">
        <div className="footer-top">
          <div>
            <FooterLogo />
            <div className="footer-tagline">
              {tagline ?? (
                <>
                  Strategy. Content. Clarity.<br />
                  Built different. Built on intent.
                </>
              )}
            </div>
          </div>
          <div className="footer-col">
            <h4>&raquo; Services</h4>
            <a href="/content">Content Production</a>
            <a href="/marketing">Ongoing Marketing</a>
            <a href="/website">Website Optimisation</a>
            <a href="/branding">Brand &amp; Strategy</a>
          </div>
          <div className="footer-col">
            <h4>&raquo; Studio</h4>
            <a href="/work">Our Work</a>
            <a href="/about">About</a>
            <a href="/journal">Journal</a>
            <a href="/events">The Room</a>
          </div>
          <div className="footer-col">
            <h4>&raquo; Contact</h4>
            <a href="mailto:hello@mdmmarketing.com.au">hello@mdmmarketing.com.au</a>
            <a href="tel:+61447764477">0447 764 477</a>
            <a href="/">Main site</a>
          </div>
          <div className="footer-col">
            <h4>&raquo; Connect</h4>
            <a href="https://www.instagram.com/mdmedia._" target="_blank" rel="noreferrer noopener">Instagram</a>
            <a href="https://www.linkedin.com/company/mdmedia-marketing/" target="_blank" rel="noreferrer noopener">LinkedIn</a>
            <a href="https://www.tiktok.com/@mdmedia._" target="_blank" rel="noreferrer noopener">TikTok</a>
            <a href="https://youtube.com/@mdmediapodcast" target="_blank" rel="noreferrer noopener">YouTube</a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>&copy; 2026 MD Media Marketing Pty Ltd &middot; ABN 75 681 730 512</span>
          <span>{vol}</span>
        </div>
      </div>
    </footer>
  )
}
