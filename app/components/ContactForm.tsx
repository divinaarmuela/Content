'use client'

import { useEffect, useRef, useState } from 'react'

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$&*()-_+=/0123456789'
const rand = (arr: string) => arr[Math.floor(Math.random() * arr.length)]

function typewriterText(el: HTMLElement, finalText: string, finalHtml = finalText, speed = 45) {
  el.style.minHeight = el.offsetHeight + 'px'

  let index = 0
  let done = false

  const glitchCursor = () =>
    `<span class="tw-cursor" aria-hidden="true" style="background:${Math.random() > 0.55 ? '#298dff' : '#0c0c0c'}">${rand(CHARS)}</span>`

  const renderFull = () => {
    el.innerHTML = finalText.slice(0, index).replace(/\n/g, '<br>') + glitchCursor()
  }

  renderFull()

  const typingInterval = setInterval(() => {
    index++
    if (index >= finalText.length) {
      clearInterval(typingInterval)
      done = true
      el.innerHTML = finalHtml.replace(/\n/g, '<br>')
      el.style.minHeight = ''
    } else {
      renderFull()
    }
  }, speed)

  const cursorInterval = setInterval(() => {
    if (done) { clearInterval(cursorInterval); return }
    const cursor = el.querySelector<HTMLSpanElement>('.tw-cursor')
    if (cursor) {
      cursor.textContent = rand(CHARS)
      cursor.style.background = Math.random() > 0.55 ? '#298dff' : '#0c0c0c'
    }
  }, 60)
}

/* ── Custom dropdown ─────────────────────────────────────────── */
function CustomSelect({
  options,
  value,
  onChange,
  placeholder = 'Select',
  multi = false,
}: {
  options: string[]
  value: string | string[]
  onChange: (v: string | string[]) => void
  placeholder?: string
  multi?: boolean
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const selected = multi ? (value as string[]) : null
  const isSelected = (opt: string) => multi ? (selected as string[]).includes(opt) : value === opt

  const handleSelect = (opt: string) => {
    if (multi) {
      const cur = selected as string[]
      const next = cur.includes(opt) ? cur.filter(v => v !== opt) : [...cur, opt]
      onChange(next)
      // keep panel open for multi
    } else {
      onChange(opt)
      setOpen(false)
    }
  }

  const triggerLabel = () => {
    if (multi) {
      const cur = selected as string[]
      if (cur.length === 0) return null
      if (cur.length === 1) return cur[0]
      return `${cur.length} selected`
    }
    return value as string || null
  }

  const label = triggerLabel()

  return (
    <div className="cselect" ref={wrapRef}>
      <button
        type="button"
        className={`cselect-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-multiselectable={multi}
      >
        <span className={label ? 'cselect-value' : 'cselect-placeholder'}>
          {label || placeholder}
        </span>
        <svg
          className={`cselect-chevron${open ? ' open' : ''}`}
          width="12" height="12" viewBox="0 0 12 12" fill="none"
          aria-hidden="true"
        >
          <path d="M2 4.5L6 8.5L10 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="cselect-panel" role="listbox">
          {options.map((opt) => (
            <div
              key={opt}
              className={`cselect-option${isSelected(opt) ? ' selected' : ''}`}
              role="option"
              aria-selected={isSelected(opt)}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(opt) }}
            >
              {multi && (
                <span className={`cselect-check${isSelected(opt) ? ' checked' : ''}`} aria-hidden="true">
                  {isSelected(opt) ? '✓' : ''}
                </span>
              )}
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Form ────────────────────────────────────────────────────── */
export default function ContactForm() {
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const [model,    setModel]    = useState<string[]>([])
  const [need,     setNeed]     = useState<string[]>([])
  const [budget,   setBudget]   = useState('')
  const [timeline, setTimeline] = useState('')

  const successRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (!submitted) return
    const el = successRef.current
    if (!el) return
    el.style.visibility = 'visible'
    typewriterText(el, 'Brief received.', 'Brief <span class="blue">received.</span>')
  }, [submitted])

  const fname  = useRef<HTMLInputElement>(null)
  const lname  = useRef<HTMLInputElement>(null)
  const femail = useRef<HTMLInputElement>(null)
  const fphone = useRef<HTMLInputElement>(null)
  const fbiz   = useRef<HTMLInputElement>(null)

  function val(ref: React.RefObject<HTMLInputElement | null>) {
    return ref.current?.value.trim() ?? ''
  }

  async function submit() {
    setError(null)

    const data = {
      fname:    val(fname),
      lname:    val(lname),
      email:    val(femail),
      phone:    val(fphone),
      biz:      val(fbiz),
      model: model.join(', '),
      need: need.join(', '),
      budget,
      timeline,
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
          <h3 ref={successRef} style={{ visibility: 'hidden' }}>
            Brief <span className="blue">received.</span>
          </h3>
          <p>// Status: QUEUED_FOR_REVIEW</p>
        </div>
      </div>
    )
  }

  return (
    <div className="form-wrap">
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

      <div className="form-group">
        <label className="form-label">Service interest</label>
        <CustomSelect
          multi
          value={model}
          onChange={(v) => setModel(v as string[])}
          options={[
            'Branding & Strategy',
            'Content Production — Subscription',
            'Content Production — Project',
            'Ongoing Marketing',
            'Personal Brand',
            'Website Optimisation',
            'Multiple services',
            'Not sure yet',
          ]}
        />
      </div>

      <div className="form-group">
        <label className="form-label">What do you need produced?</label>
        <CustomSelect
          multi
          value={need}
          onChange={(v) => setNeed(v as string[])}
          options={[
            'Social video (reels / TikTok / Shorts)',
            'Brand / campaign photography',
            'Paid ad creative',
            'Podcast / long-form video',
            'Full campaign (multi-asset)',
            'Mix of the above',
          ]}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Budget range</label>
        <CustomSelect
          value={budget}
          onChange={(v) => setBudget(v as string)}
          options={[
            'Under $3K',
            '$3K to $8K',
            '$8K to $15K',
            '$15K to $30K',
            '$30K+',
            'Need guidance',
          ]}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Production timing</label>
        <CustomSelect
          value={timeline}
          onChange={(v) => setTimeline(v as string)}
          options={[
            'This month',
            'Next 1 to 2 months',
            'Next 3 months',
            'Just exploring',
          ]}
        />
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
