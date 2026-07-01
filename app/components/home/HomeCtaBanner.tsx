const CALENDLY = 'https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone'

export default function HomeCtaBanner() {
  return (
    <section className="hcta">
      <div className="hcta-blobs" aria-hidden="true">
        <span className="hcta-blob hcta-blob--blue" />
        <span className="hcta-blob hcta-blob--teal" />
        <span className="hcta-blob hcta-blob--dark" />
      </div>
      <div className="hcta-overlay" aria-hidden="true" />
      <div className="hcta-content">
        <h2 className="hcta-heading">
          Ready to stop being<br />the best-kept secret?
        </h2>
        <p className="hcta-body">
          Book a free strategy call. We&rsquo;ll look at where you&rsquo;re invisible, where the
          opportunity is, and exactly what we&rsquo;d do first. No obligation, no hard sell.
        </p>
        <a
          href={CALENDLY}
          target="_blank"
          rel="noreferrer noopener"
          className="hcta-btn"
        >
          Book a strategy call
        </a>
      </div>
    </section>
  )
}
