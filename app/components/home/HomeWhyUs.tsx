const reasons = [
  {
    title: 'Content-led, not content-only',
    body: 'We make you visible first, then build the strategy and systems behind it.',
  },
  {
    title: 'One partner, end-to-end',
    body: 'Content, paid, brand, and strategy under one roof — no juggling vendors.',
  },
  {
    title: 'Built around you',
    body: "Your content sounds like you and looks like you, not a template.",
  },
  {
    title: 'We grow at your pace',
    body: "Start small, scale when it's working. No bloated retainers for things you don't need yet.",
  },
]

export default function HomeWhyUs() {
  return (
    <section className="hwhy">
      <div className="hwhy-inner">
        <p className="hwhy-label">· WHY MD MEDIA ·</p>
        <h2 className="hwhy-heading">Why founders and local<br />businesses choose us.</h2>
        <div className="hwhy-grid">
          {reasons.map((r, i) => (
            <div className="hwhy-card" key={i}>
              <h3 className="hwhy-card-title">{r.title}</h3>
              <p className="hwhy-card-body">{r.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
