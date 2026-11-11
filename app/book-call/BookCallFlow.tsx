'use client'

import { useMemo, useState } from 'react'
import CallEmbed from './CallEmbed'
import { readFirstVisit, visitUtm } from '../lib/utm-core'
import { CALENDLY_BUDGETS, CALENDLY_SERVICES, cleanFrom, type CallAnswers } from '../lib/book-call-core'

/**
 * /book-call IN TWO STEPS (11 Nov 2026, the owner: "they will go to the booking page and answer the first step
 * questions, new lead, and Calendly comes in prefilled … if they have filled all, call booked status … make sure ads
 * all get captured").
 *   1. Calendly's OWN questions, in its words (owner: "phone number is empty, the dropdown is empty — did you even see
 *      what questions are there"), plus the business name → /api/submit: "New lead" at once, with the ad's campaign /
 *      ad set / ad / placement, the page they came from and their first visit.
 *   2. The Calendly calendar with EVERY answer already in (book-call-core: location + a1–a6). They pick a time and
 *      press Schedule; the webhook finds the lead by email and it becomes "Call booked" — one lead, never two.
 * If step 1 cannot reach the server the calendar still opens (a booking is never lost; the webhook makes the lead).
 */
// country codes for the phone field (owner, 11 Nov 2026: "make sure country code … nice dropdowns, then the number")
const COUNTRIES: [string, string, string][] = [
  ['AU', '\u{1F1E6}\u{1F1FA}', '+61'], ['NZ', '\u{1F1F3}\u{1F1FF}', '+64'], ['GB', '\u{1F1EC}\u{1F1E7}', '+44'], ['US', '\u{1F1FA}\u{1F1F8}', '+1'],
  ['CA', '\u{1F1E8}\u{1F1E6}', '+1'], ['SG', '\u{1F1F8}\u{1F1EC}', '+65'], ['PH', '\u{1F1F5}\u{1F1ED}', '+63'], ['IN', '\u{1F1EE}\u{1F1F3}', '+91'],
  ['MY', '\u{1F1F2}\u{1F1FE}', '+60'], ['ID', '\u{1F1EE}\u{1F1E9}', '+62'], ['HK', '\u{1F1ED}\u{1F1F0}', '+852'], ['AE', '\u{1F1E6}\u{1F1EA}', '+971'],
]
/** "+61" + "0412 345 678" -> "+61 412 345 678": the local leading 0 goes, spaces kept as typed */
export function fullPhone(code: string, num: string): string {
  const n = num.trim().replace(/^0+/, '')
  return n ? `${code} ${n}` : ''
}

export default function BookCallFlow() {
  const [step, setStep] = useState<1 | 2>(1)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [f, setF] = useState({ fname: '', lname: '', email: '', phone: '', biz: '', service: '', share: '', goal: '', struggles: '', budget: '', found: '' })
  const [cc, setCc] = useState('AU')
  const dial = COUNTRIES.find(c => c[0] === cc)?.[2] ?? '+61'
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(v => ({ ...v, [k]: e.target.value }))
  const prefill = useMemo(() => ({ name: `${f.fname} ${f.lname}`.trim(), email: f.email.trim() }), [f.fname, f.lname, f.email])
  const answers = useMemo<CallAnswers>(() => ({
    phone: fullPhone(dial, f.phone), service: f.service, share: f.share, goal: f.goal, struggles: f.struggles, budget: f.budget, found: f.found,
  }), [dial, f.phone, f.service, f.share, f.goal, f.struggles, f.budget, f.found])
  const ready = !!(f.fname && f.lname && f.email && f.phone && f.biz && f.service && f.share.trim() && f.found.trim())

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) { setErr('That email address doesn’t look right.'); return }
    setBusy(true)
    try {
      const from = cleanFrom(new URLSearchParams(window.location.search).get('from'))
      // everything they wrote reaches the lead: the long answers go into its notes, one line each
      const need = [f.share.trim(), f.goal.trim() && `#1 goal in 90 days: ${f.goal.trim()}`, f.struggles.trim() && `Struggles: ${f.struggles.trim()}`, f.found.trim() && `Found us: ${f.found.trim()}`].filter(Boolean).join('\n')
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fname: f.fname.trim(), lname: f.lname.trim(), email: f.email.trim(), phone: answers.phone, biz: f.biz.trim(),
          model: f.service, need, budget: f.budget || null,
          utm: visitUtm(), first_visit: readFirstVisit(), page: from ?? '/book-call', via: 'book-call',
        }),
      })
      if (res.status === 400) {
        const j = await res.json().catch(() => ({}))
        setErr(j.error ?? 'Please check the details above.')
        return
      }
    } catch {
      // the calendar still opens: a booking must never be lost to a form error
    } finally {
      setBusy(false)
    }
    setStep(2)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (step === 2) {
    return (
      <div className="bf-step2">
        <p className="bf-step">Step 2 of 2 · Pick a time — your answers are already in</p>
        <CallEmbed prefill={prefill} answers={answers} />
      </div>
    )
  }

  return (
    <form className="bf-form" onSubmit={submit} noValidate>
      <p className="bf-step">Step 1 of 2 · A few quick questions</p>
      <div className="bf-row">
        <label>First name *<input required value={f.fname} onChange={set('fname')} autoComplete="given-name" /></label>
        <label>Last name *<input required value={f.lname} onChange={set('lname')} autoComplete="family-name" /></label>
      </div>
      <label>Email *<input required type="email" value={f.email} onChange={set('email')} autoComplete="email" /></label>
      <label>Phone number *
        <span className="bf-phone">
          <span className="bf-select bf-cc">
            <select aria-label="Country code" value={cc} onChange={e => setCc(e.target.value)}>
              {COUNTRIES.map(([k, flag, code]) => <option key={k} value={k}>{flag} {code}</option>)}
            </select>
          </span>
          <input required type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} autoComplete="tel-national" placeholder="412 345 678" />
        </span>
      </label>
      <label>Business name *<input required value={f.biz} onChange={set('biz')} autoComplete="organization" /></label>
      <label>Which service are you after? *
        <span className="bf-select">
          <select required value={f.service} onChange={set('service')}>
            <option value="" disabled>Select…</option>
            {CALENDLY_SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </span>
      </label>
      <label>Tell us about your business and what you need help with *
        <textarea rows={3} value={f.share} onChange={set('share')} placeholder="Anything that will help us prepare for the call" />
      </label>
      <label>What’s your #1 goal in the next 90 days?
        <input value={f.goal} onChange={set('goal')} />
      </label>
      <label>What struggles are you currently facing?
        <input value={f.struggles} onChange={set('struggles')} />
      </label>
      <fieldset className="bf-radios">
        <legend>What is your current monthly marketing budget?</legend>
        {CALENDLY_BUDGETS.map(b => (
          <label key={b} className={`bf-radio${f.budget === b ? ' bf-radio-on' : ''}`}>
            <input type="radio" name="budget" value={b} checked={f.budget === b} onChange={set('budget')} />
            <span>{b}</span>
          </label>
        ))}
      </fieldset>
      <label>How did you find MD Marketing? *
        <input value={f.found} onChange={set('found')} placeholder="e.g. Instagram, a friend, Google" />
      </label>
      {err && <p className="bf-err" role="alert">{err}</p>}
      <button type="submit" className="bf-btn" disabled={busy || !ready}>
        {busy ? 'One moment…' : 'Next: pick a time →'}
      </button>
      <p className="bf-note">Free · 10 minutes · no obligation</p>
    </form>
  )
}
