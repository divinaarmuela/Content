'use client'

import { useState } from 'react'

/**
 * The data deletion "form". It sends nothing to our servers and stores
 * nothing: it writes the request into the person's own email app, addressed
 * to us with the subject "Data deletion", and they press send. A person on
 * our team handles every request (no automatic replies — the owner's rule).
 */

const MONO = 'var(--font-sometype), "Courier New", monospace'
const field: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'rgba(249,244,235,0.06)', color: '#f9f4eb',
  border: '1px solid rgba(249,244,235,0.2)', borderRadius: 6, padding: '12px 14px', fontSize: 16, fontFamily: 'inherit',
}
const label: React.CSSProperties = { display: 'block', fontFamily: MONO, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(249,244,235,0.55)', margin: '0 0 6px' }

export function buildDeletionMailto(to: string, v: { name: string; email: string; handle: string; details: string }): string {
  const body = [
    'Please delete the personal information you hold about me.',
    '',
    `Name: ${v.name.trim() || '-'}`,
    `Email: ${v.email.trim() || '-'}`,
    `Social media username(s): ${v.handle.trim() || '-'}`,
    '',
    v.details.trim(),
  ].join('\n')
  return `mailto:${to}?subject=${encodeURIComponent('Data deletion')}&body=${encodeURIComponent(body)}`
}

export default function DeletionRequestForm({ to }: { to: string }) {
  const [v, setV] = useState({ name: '', email: '', handle: '', details: '' })
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value })

  return (
    <form
      onSubmit={e => { e.preventDefault(); window.location.href = buildDeletionMailto(to, v) }}
      style={{ display: 'grid', gap: 16, margin: '8px 0 20px' }}
    >
      <div><label style={label} htmlFor="dd-name">Your name</label><input id="dd-name" style={field} value={v.name} onChange={set('name')} autoComplete="name" /></div>
      <div><label style={label} htmlFor="dd-email">Your email</label><input id="dd-email" type="email" style={field} value={v.email} onChange={set('email')} autoComplete="email" /></div>
      <div><label style={label} htmlFor="dd-handle">Instagram / Facebook / other username (if any)</label><input id="dd-handle" style={field} value={v.handle} onChange={set('handle')} /></div>
      <div><label style={label} htmlFor="dd-details">Anything else that helps us find your data</label><textarea id="dd-details" rows={4} style={{ ...field, resize: 'vertical' }} value={v.details} onChange={set('details')} /></div>
      <div>
        <button type="submit" style={{ background: '#f9f4eb', color: '#0B0B0B', border: 0, borderRadius: 100, padding: '14px 28px', fontFamily: MONO, fontWeight: 500, fontSize: 14, cursor: 'pointer' }}>
          Open my email to send the request →
        </button>
        <p style={{ fontSize: 13, color: 'rgba(249,244,235,0.5)', margin: '10px 0 0' }}>This opens your own email app with the request written out. Nothing is sent until you press send there.</p>
      </div>
    </form>
  )
}
