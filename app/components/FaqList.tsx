'use client'

import { useState } from 'react'

const faqs = [
  {
    num: 'Q.01',
    q: "What's the difference between subscription and project?",
    a: "Subscription is recurring monthly content built for ongoing output, your always-on engine. Project-based is one-off: campaigns, launches, brand films, or big productions with a defined start and end. Most businesses run both. Subscription for the always-on feed, project when something specific needs to happen.",
  },
  {
    num: 'Q.02',
    q: 'Do you shoot everything in-house?',
    a: "Yes. Every shoot is produced by our in-house team. Same crew every time. No rotating freelancers, no outsourced editing, no quality drift between months. If you need a specialist we don't have (like drone or aerial cinema), we bring them on named, not hidden behind a subcontractor invoice.",
  },
  {
    num: 'Q.03',
    q: 'Can you travel for shoots?',
    a: 'Yes. We shoot across Australia. Travel and logistics are scoped per project. Melbourne is home base, but the crew gets on planes regularly. Interstate or regional shoots get flagged in the quote up front, nothing creeps in later.',
  },
  {
    num: 'Q.04',
    q: 'Who owns the raw files?',
    a: "You own every final deliverable forever. Raw footage policy is scoped per engagement, some subscriptions include raw selects, larger projects include full raw delivery. We'll be clear about it in the scope, no surprises either way.",
  },
  {
    num: 'Q.05',
    q: 'Do you write scripts and captions too?',
    a: "Yes. Copy is part of production, not an afterthought. Hooks, scripts, captions, and on-screen text are all written by the team that shoots and edits the work. One craft, not three disconnected ones. The person writing the hook has watched the rushes.",
  },
  {
    num: 'Q.06',
    q: "What's the minimum engagement for subscription?",
    a: "Three months. Month one plans and produces, month two delivers and learns, month three refines and scales. After that it's month-to-month. Projects are scoped independently with no minimum beyond the scope itself.",
  },
]

export default function FaqList() {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <div className="faq-list">
      {faqs.map((faq, i) => (
        <div key={i} className={`faq-item${open === i ? ' open' : ''}`}>
          <button
            className="faq-q"
            onClick={() => setOpen(open === i ? null : i)}
            aria-expanded={open === i}
          >
            <span className="faq-q-num">{faq.num}</span>
            <span className="faq-q-text">{faq.q}</span>
            <span className="faq-icon">+</span>
          </button>
          <div className="faq-a">
            <p>{faq.a}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
