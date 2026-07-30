'use client'

import { useState } from 'react'

const FIELD =
  'w-full bg-transparent border-b border-cream/25 py-3 font-lamah text-cream placeholder:text-cream-dim/60 focus:outline-none focus:border-cream transition-colors'
const LABEL = 'block mb-3 font-lamam text-[10px] uppercase tracking-widest text-cream-dim'

// Same options and payload shape as the deployed ContactForm — multi-selects
// join with ', ' and post to /api/submit — restyled in the lama language
// (toggle pills instead of dropdowns).
const MODEL_OPTIONS = [
  'Branding & Strategy',
  'Content Production — Subscription',
  'Content Production — Project',
  'Ongoing Marketing',
  'Personal Brand',
  'Website Optimisation',
  'Multiple services',
  'Not sure yet',
]
const NEED_OPTIONS = [
  'Social video (reels / TikTok / Shorts)',
  'Brand / campaign photography',
  'Paid ad creative',
  'Podcast / long-form video',
  'Full campaign (multi-asset)',
  'Mix of the above',
]
const BUDGET_OPTIONS = ['Under $3K', '$3K to $8K', '$8K to $15K', '$15K to $30K', '$30K+', 'Need guidance']
const TIMELINE_OPTIONS = ['This month', 'Next 1 to 2 months', 'Next 3 months', 'Just exploring']

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`border px-3 py-2 font-lamam text-[10px] uppercase tracking-wider cursor-pointer transition-colors ${
        active
          ? 'border-cream bg-cream text-ink'
          : 'border-cream/25 bg-transparent text-cream hover:border-cream/60'
      }`}
    >
      {children}
    </button>
  )
}

export default function LamaContactForm() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [model, setModel] = useState<string[]>([])
  const [need, setNeed] = useState<string[]>([])
  const [budget, setBudget] = useState('')
  const [timeline, setTimeline] = useState('')

  const toggle = (list: string[], set: (v: string[]) => void, opt: string) =>
    set(list.includes(opt) ? list.filter((v) => v !== opt) : [...list, opt])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fields = Object.fromEntries(new FormData(form).entries()) as Record<string, string>
    const data = {
      ...fields,
      model: model.join(', '),
      need: need.join(', '),
      budget,
      timeline,
    }
    setStatus('sending')
    setErrorMsg('')
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error((json as { error?: string }).error ?? 'Submission failed. Please try again.')
      }
      setStatus('sent')
      form.reset()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setStatus('error')
    }
  }

  if (status === 'sent') {
    return (
      <div>
        <p className="font-lamah text-cream text-2xl">Brief received.</p>
        <p className="mt-3 font-lamam text-[10px] uppercase tracking-widest text-cream-dim">
          // STATUS: QUEUED_FOR_REVIEW
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-8">
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

      <div className="sm:col-span-2">
        <span className={LABEL}>Service interest</span>
        <div className="flex flex-wrap gap-2">
          {MODEL_OPTIONS.map((opt) => (
            <Pill key={opt} active={model.includes(opt)} onClick={() => toggle(model, setModel, opt)}>
              {opt}
            </Pill>
          ))}
        </div>
      </div>

      <div className="sm:col-span-2">
        <span className={LABEL}>What do you need produced?</span>
        <div className="flex flex-wrap gap-2">
          {NEED_OPTIONS.map((opt) => (
            <Pill key={opt} active={need.includes(opt)} onClick={() => toggle(need, setNeed, opt)}>
              {opt}
            </Pill>
          ))}
        </div>
      </div>

      <div className="sm:col-span-2">
        <span className={LABEL}>Budget range</span>
        <div className="flex flex-wrap gap-2">
          {BUDGET_OPTIONS.map((opt) => (
            <Pill key={opt} active={budget === opt} onClick={() => setBudget(budget === opt ? '' : opt)}>
              {opt}
            </Pill>
          ))}
        </div>
      </div>

      <div className="sm:col-span-2">
        <span className={LABEL}>Production timing</span>
        <div className="flex flex-wrap gap-2">
          {TIMELINE_OPTIONS.map((opt) => (
            <Pill key={opt} active={timeline === opt} onClick={() => setTimeline(timeline === opt ? '' : opt)}>
              {opt}
            </Pill>
          ))}
        </div>
      </div>

      <div className="sm:col-span-2 flex items-center gap-6">
        <button
          type="submit"
          disabled={status === 'sending'}
          className="border border-cream/25 px-6 py-4 font-lamam text-xs uppercase tracking-widest text-cream bg-transparent cursor-pointer hover:bg-cream hover:text-ink transition-colors disabled:opacity-50"
        >
          {status === 'sending' ? 'SENDING…' : 'SUBMIT BRIEF ↗'}
        </button>
        {status === 'error' && (
          <span className="font-lamam text-[10px] uppercase tracking-widest text-red-400">{errorMsg}</span>
        )}
      </div>
    </form>
  )
}
