'use client'

import { useRef, useState } from 'react'

const WEBHOOK = 'https://script.google.com/macros/s/AKfycbyuiJhIMMyAp9oLmRpqJXRlF4GNhVPDl-Hj1VhCExecXneKsCdzPJRFdoDf62cMQ4lpJg/exec'

export default function PersonalBrandForm() {
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fname    = useRef<HTMLInputElement>(null)
  const lname    = useRef<HTMLInputElement>(null)
  const femail   = useRef<HTMLInputElement>(null)
  const fphone   = useRef<HTMLInputElement>(null)
  const fbiz     = useRef<HTMLInputElement>(null)
  const findustry = useRef<HTMLInputElement>(null)
  const fsocial  = useRef<HTMLInputElement>(null)
  const fpkg     = useRef<HTMLSelectElement>(null)
  const fgoal    = useRef<HTMLTextAreaElement>(null)
  const ftimeline = useRef<HTMLSelectElement>(null)

  function v<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    ref: React.RefObject<T | null>
  ) { return ref.current?.value.trim() ?? '' }

  async function submit() {
    setError(null)
    const data = {
      source: 'Founder Personal Brand Application',
      fname: v(fname), lname: v(lname),
      email: v(femail), phone: v(fphone),
      biz: v(fbiz), industry: v(findustry),
      social: v(fsocial), package: v(fpkg),
      goal: v(fgoal), timeline: v(ftimeline),
    }
    if (!data.fname || !data.lname || !data.email || !data.phone || !data.biz) {
      setError('Please fill in name, email, phone, and business.'); return
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) {
      setError('Please enter a valid email address.'); return
    }
    setLoading(true)
    try {
      await fetch(WEBHOOK, {
        method: 'POST', mode: 'no-cors',
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
      <div className="pb-form-success">
        <h3>Application received.</h3>
        <p>We&apos;ll review your application and be in touch within 48 hours.</p>
      </div>
    )
  }

  return (
    <div className="pb-form">
      <p className="pb-form-title">Tell us about you</p>
      <p className="pb-form-sub">Takes 2 minutes. We review every application personally.</p>

      <div className="form-row">
        <div className="form-group">
          <label className="pb-label" htmlFor="pb-fname">First name<span className="req">*</span></label>
          <input type="text" id="pb-fname" className="pb-input" ref={fname} />
        </div>
        <div className="form-group">
          <label className="pb-label" htmlFor="pb-lname">Last name<span className="req">*</span></label>
          <input type="text" id="pb-lname" className="pb-input" ref={lname} />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="pb-label" htmlFor="pb-email">Email<span className="req">*</span></label>
          <input type="email" id="pb-email" className="pb-input" ref={femail} />
        </div>
        <div className="form-group">
          <label className="pb-label" htmlFor="pb-phone">Phone<span className="req">*</span></label>
          <input type="tel" id="pb-phone" className="pb-input" ref={fphone} />
        </div>
      </div>

      <div className="form-group">
        <label className="pb-label" htmlFor="pb-biz">Business name &amp; website<span className="req">*</span></label>
        <input type="text" id="pb-biz" className="pb-input" ref={fbiz} />
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="pb-label" htmlFor="pb-industry">What do you do?</label>
          <input type="text" id="pb-industry" className="pb-input" ref={findustry} />
        </div>
        <div className="form-group">
          <label className="pb-label" htmlFor="pb-social">Where&apos;s your brand currently?</label>
          <input type="text" id="pb-social" className="pb-input" placeholder="@handle or platform" ref={fsocial} />
        </div>
      </div>

      <div className="form-group">
        <label className="pb-label" htmlFor="pb-pkg">Which level feels right?</label>
        <select id="pb-pkg" className="pb-select" ref={fpkg}>
          <option value="">Select an option</option>
          <option>Strategy + Content</option>
          <option>Full Management</option>
          <option>Not sure, help me figure it out</option>
        </select>
      </div>

      <div className="form-group">
        <label className="pb-label" htmlFor="pb-goal">What would a strong personal brand unlock for you?</label>
        <textarea id="pb-goal" className="pb-textarea" ref={fgoal} />
      </div>

      <div className="form-group">
        <label className="pb-label" htmlFor="pb-timeline">When are you looking to start?</label>
        <select id="pb-timeline" className="pb-select" ref={ftimeline}>
          <option value="">Select timeline</option>
          <option>Ready to start this month</option>
          <option>Next 1 to 2 months</option>
          <option>Next 3 months</option>
          <option>Just exploring</option>
        </select>
      </div>

      {error && (
        <p style={{ fontSize: '13px', color: '#FF5C00', marginBottom: '16px', fontFamily: 'var(--mono)' }}>
          {error}
        </p>
      )}

      <button className="pb-submit" onClick={submit} disabled={loading}>
        {loading ? 'Sending...' : 'Submit application'} →
      </button>
    </div>
  )
}
