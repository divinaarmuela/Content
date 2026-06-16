'use client'

import { useRef, useState } from 'react'

const WEBHOOK = 'https://script.google.com/macros/s/AKfycbyuiJhIMMyAp9oLmRpqJXRlF4GNhVPDl-Hj1VhCExecXneKsCdzPJRFdoDf62cMQ4lpJg/exec'

export default function MarketingForm() {
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fname = useRef<HTMLInputElement>(null)
  const lname = useRef<HTMLInputElement>(null)
  const femail = useRef<HTMLInputElement>(null)
  const fphone = useRef<HTMLInputElement>(null)
  const fbiz = useRef<HTMLInputElement>(null)
  const findustry = useRef<HTMLInputElement>(null)
  const fstage = useRef<HTMLSelectElement>(null)
  const ftier = useRef<HTMLSelectElement>(null)
  const fbudget = useRef<HTMLSelectElement>(null)
  const ftimeline = useRef<HTMLSelectElement>(null)

  function val(ref: React.RefObject<HTMLInputElement | HTMLSelectElement | null>) {
    return ref.current?.value.trim() ?? ''
  }

  async function submit() {
    setError(null)
    const data = {
      source: 'Marketing Application',
      fname: val(fname), lname: val(lname),
      email: val(femail), phone: val(fphone),
      biz: val(fbiz), industry: val(findustry),
      stage: val(fstage), tier: val(ftier),
      budget: val(fbudget), timeline: val(ftimeline),
    }
    if (!data.fname || !data.lname || !data.email || !data.phone || !data.biz) {
      setError('Please fill in name, email, phone, and business.')
      return
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) {
      setError('Please enter a valid email address.')
      return
    }
    setLoading(true)
    try {
      await fetch(WEBHOOK, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(data),
      })
      setSubmitted(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="form-wrap">
        <div className="form-success">
          <h3>Application <span className="blue">received.</span></h3>
          <p>// Status: QUEUED_FOR_REVIEW</p>
        </div>
      </div>
    )
  }

  return (
    <div className="form-wrap">
      <div className="form-header">
        <span>// FORM_ID: MKT_RETAINER_APP</span>
        <span className="status"><span className="dot"></span>ACCEPTING SUBMISSIONS</span>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="mkt-fname">First name<span className="req">*</span></label>
          <input type="text" id="mkt-fname" className="form-input" ref={fname} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="mkt-lname">Last name<span className="req">*</span></label>
          <input type="text" id="mkt-lname" className="form-input" ref={lname} />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="mkt-email">Email<span className="req">*</span></label>
          <input type="email" id="mkt-email" className="form-input" ref={femail} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="mkt-phone">Phone<span className="req">*</span></label>
          <input type="tel" id="mkt-phone" className="form-input" ref={fphone} />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="mkt-biz">Business name &amp; website<span className="req">*</span></label>
        <input type="text" id="mkt-biz" className="form-input" ref={fbiz} />
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="mkt-industry">Industry</label>
          <input type="text" id="mkt-industry" className="form-input" ref={findustry} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="mkt-stage">Marketing stage</label>
          <select id="mkt-stage" className="form-select" ref={fstage}>
            <option value="">Select</option>
            <option>Doing it ourselves</option>
            <option>Have a freelancer / contractor</option>
            <option>Had an agency, didn&apos;t work</option>
            <option>Starting from scratch</option>
          </select>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="mkt-tier">Tier interest</label>
        <select id="mkt-tier" className="form-select" ref={ftier}>
          <option value="">Select</option>
          <option>Starter</option>
          <option>Growth</option>
          <option>Scale</option>
          <option>Premium</option>
          <option>Need guidance</option>
        </select>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="mkt-budget">Monthly budget range</label>
        <select id="mkt-budget" className="form-select" ref={fbudget}>
          <option value="">Select</option>
          <option>$3.5K to $5K</option>
          <option>$5K to $8K</option>
          <option>$8K to $12K</option>
          <option>$12K+</option>
          <option>Need guidance</option>
        </select>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="mkt-timeline">Start timing</label>
        <select id="mkt-timeline" className="form-select" ref={ftimeline}>
          <option value="">Select</option>
          <option>Ready to start this month</option>
          <option>Next 1 to 2 months</option>
          <option>Next 3 months</option>
          <option>Just exploring</option>
        </select>
      </div>

      {error && (
        <p style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--red)', marginBottom: '16px' }}>
          {error}
        </p>
      )}

      <button className="submit-btn" onClick={submit} disabled={loading}>
        {loading ? 'Sending...' : 'Submit application'} <span className="arr">→</span>
      </button>
    </div>
  )
}
