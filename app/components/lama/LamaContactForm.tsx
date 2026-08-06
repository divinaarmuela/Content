'use client'

import { useEffect, useRef, useState } from 'react'

const FIELD =
  // text-base (16px) matters: anything smaller makes iOS Safari auto-zoom the
  // page when the field is focused
  'w-full bg-transparent border-b border-cream/25 py-3 font-lamah text-base text-cream placeholder:text-cream-dim/60 focus:outline-none focus:border-cream transition-colors'
const LABEL = 'block mb-3 font-lamam text-[10px] uppercase tracking-widest text-cream-dim'

// Same options and payload shape as the deployed ContactForm — multi-selects
// join with ', ' and post to /api/submit — restyled in the lama language.
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

// Lama-styled dropdown: mono trigger on a bottom border, dark panel with
// checkmark rows; multi keeps the panel open while toggling
function LamaSelect({
  options,
  value,
  onChange,
  multi = false,
  placeholder = 'SELECT',
}: {
  options: string[]
  value: string | string[]
  onChange: (v: string | string[]) => void
  multi?: boolean
  placeholder?: string
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
  const isSelected = (opt: string) => (multi ? (selected as string[]).includes(opt) : value === opt)

  const handleSelect = (opt: string) => {
    if (multi) {
      const cur = selected as string[]
      onChange(cur.includes(opt) ? cur.filter((v) => v !== opt) : [...cur, opt])
    } else {
      onChange((value as string) === opt ? '' : opt)
      setOpen(false)
    }
  }

  const label = multi
    ? (selected as string[]).length === 0
      ? null
      : (selected as string[]).length === 1
        ? (selected as string[])[0]
        : `${(selected as string[]).length} SELECTED`
    : (value as string) || null

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-4 bg-transparent border-b border-cream/25 px-3 py-3 cursor-pointer text-left hover:border-cream/60 transition-colors"
      >
        <span className={`font-lamah ${label ? 'text-cream' : 'text-cream-dim/60'}`}>
          {label ?? placeholder}
        </span>
        <span
          aria-hidden="true"
          className={`font-lamam text-[10px] text-cream-dim transition-transform ${open ? 'rotate-180' : ''}`}
        >
          ▼
        </span>
      </button>
      {open && (
        <div
          role="listbox"
          aria-multiselectable={multi}
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-auto border border-cream/25 bg-ink shadow-xl"
        >
          {options.map((opt) => (
            <div
              key={opt}
              role="option"
              aria-selected={isSelected(opt)}
              onMouseDown={(e) => {
                e.preventDefault()
                handleSelect(opt)
              }}
              className={`flex items-center gap-3 px-4 py-3 cursor-pointer font-lamah text-sm transition-colors ${
                isSelected(opt) ? 'bg-cream text-ink' : 'text-cream hover:bg-cream/10'
              }`}
            >
              {multi && (
                <span className="font-lamam text-[10px] w-3 shrink-0">{isSelected(opt) ? '✓' : ''}</span>
              )}
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function LamaContactForm() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [model, setModel] = useState<string[]>([])
  const [need, setNeed] = useState<string[]>([])
  const [budget, setBudget] = useState('')
  const [timeline, setTimeline] = useState('')

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
        <LamaSelect multi options={MODEL_OPTIONS} value={model} onChange={(v) => setModel(v as string[])} />
      </div>

      <div className="sm:col-span-2">
        <span className={LABEL}>What do you need produced?</span>
        <LamaSelect multi options={NEED_OPTIONS} value={need} onChange={(v) => setNeed(v as string[])} />
      </div>

      <div>
        <span className={LABEL}>Budget range</span>
        <LamaSelect options={BUDGET_OPTIONS} value={budget} onChange={(v) => setBudget(v as string)} />
      </div>

      <div>
        <span className={LABEL}>Production timing</span>
        <LamaSelect options={TIMELINE_OPTIONS} value={timeline} onChange={(v) => setTimeline(v as string)} />
      </div>

      <div className="sm:col-span-2 flex items-center gap-6">
        <button
          type="submit"
          disabled={status === 'sending'}
          className="border border-cream/25 px-6 py-4 font-lamam text-xs uppercase tracking-widest text-cream bg-transparent cursor-pointer hover:bg-cream hover:text-ink transition-colors disabled:opacity-50"
        >
          {status === 'sending' ? 'SENDING…' : 'SUBMIT BRIEF ↗︎'}
        </button>
        {status === 'error' && (
          <span className="font-lamam text-[10px] uppercase tracking-widest text-red-400">{errorMsg}</span>
        )}
      </div>
    </form>
  )
}
