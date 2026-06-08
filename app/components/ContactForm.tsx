'use client'

import { useRef, useState } from 'react'

export default function ContactForm() {
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fname = useRef<HTMLInputElement>(null)
  const lname = useRef<HTMLInputElement>(null)
  const femail = useRef<HTMLInputElement>(null)
  const fphone = useRef<HTMLInputElement>(null)
  const fbiz = useRef<HTMLInputElement>(null)
  const findustry = useRef<HTMLInputElement>(null)
  const fmodel = useRef<HTMLSelectElement>(null)
  const fneed = useRef<HTMLSelectElement>(null)
  const fbudget = useRef<HTMLSelectElement>(null)
  const ftimeline = useRef<HTMLSelectElement>(null)

  function val(ref: React.RefObject<HTMLInputElement | HTMLSelectElement | null>) {
    return ref.current?.value.trim() ?? ''
  }

  async function submit() {
    setError(null)

    const data = {
      fname: val(fname),
      lname: val(lname),
      email: val(femail),
      phone: val(fphone),
      biz: val(fbiz),
      industry: val(findustry),
      model: val(fmodel),
      need: val(fneed),
      budget: val(fbudget),
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
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? 'Submission failed. Please try again.')
      }

      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="form-wrap">
        <div className="form-success">
          <h3>
            Brief <span className="blue">received.</span>
          </h3>
          <p>// Status: QUEUED_FOR_REVIEW &middot; We&apos;ll be in touch shortly</p>
        </div>
      </div>
    )
  }

  return (
    <div className="form-wrap">
      <div className="form-header">
        <span>// FORM_ID: CONTENT_BRIEF_APP</span>
        <span className="status">
          <span className="dot"></span>STUDIO OPEN
        </span>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="fname">
            First name<span className="req">*</span>
          </label>
          <input type="text" id="fname" className="form-input" ref={fname} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="lname">
            Last name<span className="req">*</span>
          </label>
          <input type="text" id="lname" className="form-input" ref={lname} />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="femail">
            Email<span className="req">*</span>
          </label>
          <input type="email" id="femail" className="form-input" ref={femail} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="fphone">
            Phone<span className="req">*</span>
          </label>
          <input type="tel" id="fphone" className="form-input" ref={fphone} />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="fbiz">
          Business name &amp; website<span className="req">*</span>
        </label>
        <input type="text" id="fbiz" className="form-input" ref={fbiz} />
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="findustry">
            Industry
          </label>
          <input type="text" id="findustry" className="form-input" ref={findustry} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="fmodel">
            Model interest
          </label>
          <select id="fmodel" className="form-select" ref={fmodel}>
            <option value="">Select</option>
            <option>Subscription (recurring monthly)</option>
            <option>Project (one-off production)</option>
            <option>Both</option>
            <option>Not sure yet</option>
          </select>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="fneed">
          What do you need produced?
        </label>
        <select id="fneed" className="form-select" ref={fneed}>
          <option value="">Select</option>
          <option>Social video (reels / TikTok / Shorts)</option>
          <option>Brand / campaign photography</option>
          <option>Paid ad creative</option>
          <option>Podcast / long-form video</option>
          <option>Full campaign (multi-asset)</option>
          <option>Mix of the above</option>
        </select>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="fbudget">
          Budget range
        </label>
        <select id="fbudget" className="form-select" ref={fbudget}>
          <option value="">Select</option>
          <option>Under $3K</option>
          <option>$3K to $8K</option>
          <option>$8K to $15K</option>
          <option>$15K to $30K</option>
          <option>$30K+</option>
          <option>Need guidance</option>
        </select>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="ftimeline">
          Production timing
        </label>
        <select id="ftimeline" className="form-select" ref={ftimeline}>
          <option value="">Select</option>
          <option>This month</option>
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
        {loading ? 'Sending...' : 'Submit brief'} <span className="arr">→</span>
      </button>
    </div>
  )
}
