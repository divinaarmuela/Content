const CALENDLY = 'https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone'

const steps = [
  {
    num: '01',
    title: 'Strategy call',
    body: "We get clear on your business, your goals, and where the gaps are. No pitch deck, no jargon — just a plan.",
  },
  {
    num: '02',
    title: 'We build your visibility',
    body: "We create the content and assets that get you seen, and we handle the moving parts so you can stay in your zone.",
  },
  {
    num: '03',
    title: 'We scale what works',
    body: "Once you're showing up, we add paid, brand, and strategy to turn attention into a steady flow of customers.",
  },
]

export default function HomeHowItWorks() {
  return (
    <section className="hhiw">
      <div className="hhiw-inner">
        <div className="hhiw-header">
          <p className="hhiw-label">· HOW IT WORKS ·</p>
          <h2 className="hhiw-heading">From invisible to in-demand,<br />in three steps.</h2>
        </div>
        <div className="hhiw-steps">
          {steps.map((s) => (
            <div className="hhiw-step" key={s.num}>
              <span className="hhiw-step-num">{s.num}</span>
              <div className="hhiw-step-text">
                <h3 className="hhiw-step-title">{s.title}</h3>
                <p className="hhiw-step-body">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
        <a
          href={CALENDLY}
          target="_blank"
          rel="noreferrer noopener"
          className="hhiw-cta"
        >
          Book your strategy call
        </a>
      </div>
    </section>
  )
}
