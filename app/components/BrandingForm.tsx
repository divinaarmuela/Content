'use client'

import { useRef, useState } from 'react'

const WEBHOOK = 'https://script.google.com/macros/s/AKfycbyuiJhIMMyAp9oLmRpqJXRlF4GNhVPDl-Hj1VhCExecXneKsCdzPJRFdoDf62cMQ4lpJg/exec'

export default function BrandingForm() {
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fname = useRef<HTMLInputElement>(null)
  const lname = useRef<HTMLInputElement>(null)
  const femail = useRef<HTMLInputElement>(null)
  const fphone = useRef<HTMLInputElement>(null)
  const fbiz = useRef<HTMLInputElement>(null)
  const findustry = useRef<HTMLInputElement>(null)
  const fproject = useRef<HTMLSelectElement>(null)
  const fbudget = useRef<HTMLSelectElement>(null)
  const ftimeline = useRef<HTMLSelectElement>(null)

  function val(ref: React.RefObject<HTMLInputElement | HTMLSelectElement | null>) {
    return ref.current?.value.trim() ?? ''
  }

  async function submit() {
    setError(null)
    const data = {
      source: 'Branding Application',
      fname: val(fname), lname: val(lname),
      email: val(femail), phone: val(fphone),
      biz: val(fbiz), industry: val(findustry),
      project: val(fproject), budget: val(fbudget),
      timeline: val(ftimeline),
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
        <span>// FORM_ID: BRAND_BUILD_APP</span>
        <span className="status"><span className="dot"></span>TAKING BRIEFS</span>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="br-fname">First name<span className="req">*</span></label>
          <input type="text" id="br-fname" className="form-input" ref={fname} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="br-lname">Last name<span className="req">*</span></label>
          <input type="text" id="br-lname" className="form-input" ref={lname} />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="br-email">Email<span className="req">*</span></label>
          <input type="email" id="br-email" className="form-input" ref={femail} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="br-phone">Phone<span className="req">*</span></label>
          <input type="tel" id="br-phone" className="form-input" ref={fphone} />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="br-biz">Business name &amp; website<span className="req">*</span></label>
        <input type="text" id="br-biz" className="form-input" ref={fbiz} />
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="br-industry">What do you do?</label>
          <input type="text" id="br-industry" className="form-input" ref={findustry} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="br-project">Project type</label>
          <select id="br-project" className="form-select" ref={fproject}>
            <option value="">Select</option>
            <option>New brand from scratch</option>
            <option>Full rebrand</option>
            <option>Brand refresh / evolution</option>
            <option>Not sure yet</option>
          </select>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="br-budget">Ballpark budget</label>
        <select id="br-budget" className="form-select" ref={fbudget}>
          <option value="">Select range</option>
          <option>Under $10K</option>
          <option>$10K to $25K</option>
          <option>$25K to $50K</option>
          <option>$50K+</option>
          <option>Need guidance</option>
        </select>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="br-timeline">When do you want to start?</label>
        <select id="br-timeline" className="form-select" ref={ftimeline}>
          <option value="">Select timeline</option>
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
