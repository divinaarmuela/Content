'use client'

import { useMemo, useState } from 'react'
import CallEmbed from './CallEmbed'
import { readFirstVisit, visitUtm } from '../lib/utm-core'
import { cleanFrom } from '../lib/book-call-core'

/**
 * /book-call IN TWO STEPS (11 Nov 2026, the owner: "they will go to the booking page and answer the first step
 * questions, new lead, and Calendly comes in prefilled … if they have filled all, call booked status … make sure ads
 * all get captured").
 *   1. A short form → /api/submit, the website form's own route: the lead appears on Leads as "New lead" straight
 *      away, with the ad's campaign / ad set / ad / placement, the page they came from and their first visit.
 *   2. The Calendly calendar, prefilled with the same name and email. When they book, the webhook finds that lead
 *      by email and it becomes "Call booked" — one lead, never two.
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

const SERVICES = ['Strategy & consulting', 'Branding', 'Website / tech', 'Content & visibility', 'A campaign shoot', 'Hospitality marketing', 'Not sure yet']

export default function BookCallFlow() {
  const [step, setStep] = useState<1 | 2>(1)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [f, setF] = useState({ fname: '', lname: '', email: '', phone: '', biz: '', model: '', need: '' })
  const [cc, setCc] = useState('AU')
  const dial = COUNTRIES.find(c => c[0] === cc)?.[2] ?? '+61'
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(v => ({ ...v, [k]: e.target.value }))
  const prefill = useMemo(() => ({ name: `${f.fname} ${f.lname}`.trim(), email: f.email.trim() }), [f.fname, f.lname, f.email])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) { setErr('That email address doesn’t look right.'); return }
    setBusy(true)
    try {
      const from = cleanFrom(new URLSearchParams(window.location.search).get('from'))
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, phone: fullPhone(dial, f.phone), email: f.email.trim(), utm: visitUtm(), first_visit: readFirstVisit(), page: from ?? '/book-call', via: 'book-call' }),
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
        <p className="bf-step">Step 2 of 2 · Pick a time</p>
        <CallEmbed prefill={prefill} />
      </div>
    )
  }

  return (
    <form className="bf-form" onSubmit={submit} noValidate>
      <p className="bf-step">Step 1 of 2 · A few quick questions</p>
      <div className="bf-row">
        <label>First name<input required value={f.fname} onChange={set('fname')} autoComplete="given-name" /></label>
        <label>Last name<input required value={f.lname} onChange={set('lname')} autoComplete="family-name" /></label>
      </div>
      <label>Email<input required type="email" value={f.email} onChange={set('email')} autoComplete="email" /></label>
      <label>Phone
        <span className="bf-phone">
          <span className="bf-select bf-cc">
            <select aria-label="Country code" value={cc} onChange={e => setCc(e.target.value)}>
              {COUNTRIES.map(([k, flag, code]) => <option key={k} value={k}>{flag} {code}</option>)}
            </select>
          </span>
          <input required type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} autoComplete="tel-national" placeholder="412 345 678" />
        </span>
      </label>
      <label>Business name<input required value={f.biz} onChange={set('biz')} autoComplete="organization" /></label>
      <label>What can we help with?
        <span className="bf-select">
          <select required value={f.model} onChange={set('model')}>
            <option value="" disabled>Choose one</option>
            {SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </span>
      </label>
      <label>Anything we should know? <span className="bf-opt">(optional)</span>
        <textarea rows={3} value={f.need} onChange={set('need')} placeholder="Where you are now, what you want to happen next" />
      </label>
      {err && <p className="bf-err" role="alert">{err}</p>}
      <button type="submit" className="bf-btn" disabled={busy || !f.fname || !f.lname || !f.email || !f.phone || !f.biz || !f.model}>
        {busy ? 'One moment…' : 'Next: pick a time →'}
      </button>
      <p className="bf-note">Free · 10 minutes · no obligation</p>
    </form>
  )
}
