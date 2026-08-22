export default function SiteHeader() {
  return (
    <>
      <div className="status-bar">
        <div className="container status-bar-inner">
          <span><span className="status-dot"></span><span className="status-muted">AGENCY</span> OPEN</span>
          <span className="status-muted">&middot; &middot; &middot;</span>
          <span>
            <span className="status-muted">VOL.</span> 01{' '}
            <span className="status-sep">/</span>{' '}
            <span className="status-muted">NODE.</span> MAIN
          </span>
          <span className="status-muted">&middot; &middot; &middot;</span>
          <span><span className="status-muted">LOC.</span> MELBOURNE, AU</span>
        </div>
      </div>

      <nav aria-label="Primary">
        <div className="container nav-inner">
          <a href="/" className="nav-logo" aria-label="MD Media home">
            <img
              src="https://static.wixstatic.com/media/c5a69a_eb5dd45dbca445798fa310acb86c4420~mv2.png"
              alt="MD Media Marketing"
            />
          </a>
          <div className="nav-links">
            <a href="/content">Content</a>
            <a href="/branding">Branding</a>
            <a href="/marketing">Marketing</a>
            <a href="/work">Work</a>
          </div>
          <a
            href="https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone"
            className="nav-cta"
            target="_blank"
            rel="noreferrer noopener"
          >
            Say Hello →
          </a>
        </div>
      </nav>
    </>
  )
}
