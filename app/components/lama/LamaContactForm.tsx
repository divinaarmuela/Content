'use client'

import { useState } from 'react'

const FIELD =
  'w-full bg-transparent border-b border-cream/25 py-3 font-lamah text-cream placeholder:text-cream-dim/60 focus:outline-none focus:border-cream transition-colors'
const LABEL = 'font-lamam text-[10px] uppercase tracking-widest text-cream-dim'

// Compact contact form in the lama visual language, posting to the site's
// existing /api/submit endpoint (fname/lname/email/phone/biz + need).
export default function LamaContactForm() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = Object.fromEntries(new FormData(form).entries())
    setStatus('sending')
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('failed')
      setStatus('sent')
      form.reset()
    } catch {
      setStatus('error')
    }
  }

  if (status === 'sent') {
    return (
      <p className="font-lamam text-xs uppercase tracking-widest text-cream">
        [ MESSAGE SENT. WE&rsquo;LL BE IN TOUCH. ]
      </p>
    )
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">
      <label className="block">
        <span className={LABEL}>First name *</span>
        <input name="fname" required autoComplete="given-name" className={FIELD} />
      </label>
      <label className="block">
        <span className={LABEL}>Last name *</span>
        <input name="lname" required autoComplete="family-name" className={FIELD} />
      </label>
      <label className="block">
        <span className={LABEL}>Email *</span>
        <input name="email" type="email" required autoComplete="email" className={FIELD} />
      </label>
      <label className="block">
        <span className={LABEL}>Phone *</span>
        <input name="phone" type="tel" required autoComplete="tel" className={FIELD} />
      </label>
      <label className="block sm:col-span-2">
        <span className={LABEL}>Business name *</span>
        <input name="biz" required autoComplete="organization" className={FIELD} />
      </label>
      <label className="block sm:col-span-2">
        <span className={LABEL}>What do you need?</span>
        <textarea name="need" rows={3} className={`${FIELD} resize-none`} />
      </label>
      <div className="sm:col-span-2 flex items-center gap-6">
        <button
          type="submit"
          disabled={status === 'sending'}
          className="border border-cream/25 px-6 py-4 font-lamam text-xs uppercase tracking-widest text-cream bg-transparent cursor-pointer hover:bg-cream hover:text-ink transition-colors disabled:opacity-50"
        >
          {status === 'sending' ? 'SENDING…' : 'SEND MESSAGE ↗'}
        </button>
        {status === 'error' && (
          <span className="font-lamam text-[10px] uppercase tracking-widest text-red-400">
            [ SOMETHING WENT WRONG, TRY AGAIN ]
          </span>
        )}
      </div>
    </form>
  )
}
