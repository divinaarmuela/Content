import CtaHeading from './CtaHeading'
import ContactForm from './ContactForm'

/** Closing CTA: reuses the homepage split layout (typewriter heading + form). */
export default function ServiceCta({
  ready = 'Ready?',
  sub,
  buttonLabel = 'Or Just Say Hello',
  buttonHref = 'https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone',
}: {
  ready?: string
  sub: React.ReactNode
  buttonLabel?: string
  buttonHref?: string
}) {
  return (
    <section className="cta-section" id="contact">
      <div className="container">
        <div className="cta-split">
          <div className="cta-left">
            <p className="cta-ready">{ready}</p>
            <CtaHeading />
            <p className="cta-sub">{sub}</p>
            <div className="cta-btns">
              <a href={buttonHref} className="btn" target="_blank" rel="noreferrer noopener">
                {buttonLabel} <span className="arr">→</span>
              </a>
            </div>
          </div>
          <div className="cta-right">
            <ContactForm />
          </div>
        </div>
      </div>
    </section>
  )
}
