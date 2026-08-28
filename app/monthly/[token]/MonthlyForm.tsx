'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  completion, type Answers, type IntakeStatus, type TemplateDefinition,
} from '../../lib/intake-core'
import {
  GuidanceBlock, TextBlock, SelectBlock, MultiSelectBlock,
} from '../../intake/[token]/blocks'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * The monthly check-in the client fills in, one section per step.
 *
 * A trimmed twin of the intake form (same dark lama system, same autosave, same
 * resume-where-you-stopped, same step rail) — but shorter, warmer, and with no
 * file uploads. It reuses the intake block renderers directly rather than
 * copying them, and all the counting/merging lives in intake-core.
 *
 * "Takes about 5 minutes" is a promise, so every field autosaves and coming
 * back lands on the first section still missing answers rather than at the top.
 */
export default function MonthlyForm({
  token, clientName, title, period, definition, initialAnswers, initialStatus,
}: {
  token: string
  clientName: string
  title: string
  period: string
  definition: TemplateDefinition
  initialAnswers: Answers
  initialStatus: IntakeStatus
}) {
  const [answers, setAnswers] = useState<Answers>(initialAnswers)
  const [status, setStatus] = useState<IntakeStatus>(initialStatus)
  const [save, setSave] = useState<SaveState>('idle')
  const [submitting, setSubmitting] = useState(false)
  const [step, setStep] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // the newest value per field, so a debounced flush sends what is on screen
  const pending = useRef<Answers>({})

  const locked = status === 'submitted'
  const progress = useMemo(() => completion(definition, answers), [definition, answers])
  const pct = progress.total === 0 ? 0 : Math.round((progress.answered / progress.total) * 100)

  // steps = every section, then a review step at the end
  const lastStep = definition.sections.length
  const onReview = step === lastStep
  const [reviewed, setReviewed] = useState(false)
  useEffect(() => { if (onReview) setReviewed(true) }, [onReview])
  const section = definition.sections[step]
  /** A section of nothing but guidance is a cover, not a form page. */
  const isCover = Boolean(section) && section.blocks.every(b => b.type === 'guidance')

  // Resume where they stopped: the first section with anything still missing.
  useEffect(() => {
    if (progress.answered === 0) return
    const next = progress.sections.findIndex(s => s.total > 0 && s.answered < s.total)
    setStep(next === -1 ? definition.sections.length : next)
    // deliberately once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const flush = useCallback(async () => {
    const patch = pending.current
    pending.current = {}
    if (Object.keys(patch).length === 0) return
    setSave('saving')
    try {
      const res = await fetch(`/api/monthly/${token}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error(String(res.status))
      const json = await res.json()
      setStatus(json.status as IntakeStatus)
      setSave('saved')
    } catch {
      // put it back so the next keystroke retries rather than losing the edit
      pending.current = { ...patch, ...pending.current }
      setSave('error')
    }
  }, [token])

  const set = useCallback((id: string, value: string | string[]) => {
    setAnswers(prev => ({ ...prev, [id]: value }))
    pending.current[id] = value
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), 800)
  }, [flush])

  /** Never leave a step without saving what is in it. */
  const goto = useCallback(async (next: number) => {
    if (timer.current) clearTimeout(timer.current)
    await flush()
    setStep(Math.max(0, Math.min(lastStep, next)))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [flush, lastStep])

  const submit = useCallback(async () => {
    setSubmitting(true)
    if (timer.current) clearTimeout(timer.current)
    await flush()
    try {
      const res = await fetch(`/api/monthly/${token}/submit`, { method: 'POST' })
      if (res.ok) {
        setStatus('submitted')
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } else {
        setSave('error')
      }
    } finally {
      setSubmitting(false)
    }
  }, [flush, token])

  const savedLabel =
    save === 'saving' ? 'Saving'
    : save === 'error' ? 'Not saved'
    : save === 'saved' ? 'Saved'
    : `${progress.answered} / ${progress.total}`

  // ── already submitted ──────────────────────────────────────────────────────
  if (locked) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-ink px-6 text-cream">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/MDLogo-trim.png" alt="MD Media" className="mb-10 h-6 w-auto" />
        <h1 className="max-w-[18ch] text-center font-lamah text-[34px] font-medium leading-[1.1] tracking-[-0.03em] sm:text-[44px]">
          Thank you. We&apos;ll plan around this.
        </h1>
        <p className="mt-6 max-w-[46ch] text-center font-lamah text-[16px] leading-relaxed text-cream-dim">
          This is exactly what we use to map out your {period} content. If
          something needs changing, email us at hello@mdmmarketing.com.au and we
          will reopen it for you.
        </p>
        <p className="mt-10 font-lamam text-[10px] uppercase tracking-widest text-cream-faint">
          {progress.answered} of {progress.total} answered
        </p>
      </div>
    )
  }

  return (
    <div className="intake min-h-screen bg-ink text-cream antialiased">
      {/* ── docked bar ── */}
      <header className="sticky top-0 z-30 border-b border-cream/15 bg-ink/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/MDLogo-trim.png" alt="MD Media" className="h-5 w-auto" />
          <p className="hidden font-lamam text-[10px] uppercase tracking-widest text-cream-dim sm:block">
            {clientName ? `${clientName} · ${period}` : period}
          </p>
          <p
            className={
              'ml-auto font-lamam text-[10px] uppercase tracking-widest tabular-nums ' +
              (save === 'error' ? 'text-[#E2725B]' : 'text-cream-dim')
            }
          >
            {savedLabel}{save === 'idle' ? ' answered' : ''}
          </p>
        </div>
        <div className="h-px w-full bg-cream/10">
          <div className="h-px bg-cream transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 py-12 sm:py-16">
        {/* Step rail. A plain <div>, NOT <nav>: globals.css styles bare nav
            elements for the marketing site — CLAUDE.md trap 2. */}
        <div role="navigation" aria-label="Sections" className="mb-12 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="font-lamam text-[10px] uppercase tracking-widest text-cream-dim">
              {onReview ? 'Review and send' : `Step ${step + 1} of ${lastStep}`}
            </p>
            <p className="font-lamam text-[10px] uppercase tracking-widest text-cream-faint">
              {onReview ? '' : definition.sections[step].title}
            </p>
          </div>
          <div className="flex gap-1">
            {definition.sections.map((s, i) => {
              const done = progress.sections[i]
              const complete = done.total > 0 && done.answered === done.total
              return (
                <button
                  key={s.id} type="button" onClick={() => void goto(i)}
                  title={`${i + 1}. ${s.title} (${done.answered}/${done.total})`}
                  aria-label={`${s.title}, ${done.answered} of ${done.total} answered`}
                  aria-current={i === step ? 'step' : undefined}
                  className={
                    'h-1 flex-1 rounded-full transition-colors ' +
                    (i === step ? 'bg-cream'
                      : complete ? 'bg-cream/55'
                      : done.answered > 0 ? 'bg-cream/30'
                      : 'bg-cream/15 hover:bg-cream/30')
                  }
                />
              )
            })}
            <button
              type="button" onClick={() => void goto(lastStep)}
              title="Review and send" aria-label="Review and send"
              className={
                'h-1 w-8 rounded-full transition-colors ' +
                (onReview ? 'bg-cream' : 'bg-cream/15 hover:bg-cream/30')
              }
            />
          </div>
        </div>

        {onReview ? (
          /* ── review and send ── */
          <div className="flex flex-col gap-10">
            <div>
              <p className="font-lamam text-[10px] uppercase tracking-widest text-cream-dim">
                Last step
              </p>
              <h1 className="mt-4 font-lamah text-[34px] font-medium leading-[1.05] tracking-[-0.03em] sm:text-[44px]">
                Ready when you are.
              </h1>
              <p className="mt-5 max-w-[54ch] font-lamah text-[16px] leading-relaxed text-cream-dim">
                You have answered {progress.answered} of {progress.total}. Incomplete
                is genuinely fine. Send us what you have and we will fill in the
                rest together on the call.
              </p>
            </div>

            <ul className="flex flex-col divide-y divide-cream/10 border-y border-cream/10">
              {definition.sections.map((s, i) => {
                const done = progress.sections[i]
                if (done.total === 0) return null
                return (
                  <li key={s.id}>
                    <button
                      type="button" onClick={() => void goto(i)}
                      className="group flex w-full items-center gap-4 py-4 text-left"
                    >
                      <span className="font-lamam text-[10px] tabular-nums tracking-widest text-cream-faint">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="font-lamah text-[15px] text-cream-dim transition-colors group-hover:text-cream">
                        {s.title}
                      </span>
                      <span
                        className={
                          'ml-auto font-lamam text-[10px] tabular-nums tracking-widest ' +
                          (done.answered === done.total ? 'text-cream' : 'text-cream-faint')
                        }
                      >
                        {done.answered}/{done.total}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>

            <div className="flex flex-wrap items-center gap-5">
              <button
                type="button" onClick={() => void submit()} disabled={submitting}
                className={
                  'group inline-flex items-center gap-3 bg-cream px-8 py-4 font-lamam ' +
                  'text-[11px] uppercase tracking-widest text-ink transition-opacity ' +
                  'hover:opacity-85 disabled:opacity-50'
                }
              >
                {submitting ? 'Sending' : 'Send to MD Media'}
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </button>
              <button
                type="button" onClick={() => void goto(lastStep - 1)}
                className="bg-transparent font-lamam text-[11px] uppercase tracking-widest text-cream-dim transition-colors hover:text-cream"
              >
                ← Back
              </button>
            </div>
          </div>
        ) : (
          /* ── one section ── */
          <div className={isCover ? 'flex flex-col gap-10' : 'grid gap-12 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] lg:gap-16'}>
            <div className={isCover ? 'flex flex-col gap-5' : 'flex flex-col gap-4 lg:sticky lg:top-32 lg:self-start'}>
              <div className="flex items-baseline gap-4">
                <span className="font-lamam text-[10px] tabular-nums tracking-widest text-cream-faint">
                  {String(step + 1).padStart(2, '0')} / {String(lastStep).padStart(2, '0')}
                </span>
                {!isCover && (
                  <span className="ml-auto font-lamam text-[10px] tabular-nums tracking-widest text-cream-faint">
                    {progress.sections[step].answered}/{progress.sections[step].total}
                  </span>
                )}
              </div>
              <h1
                className={
                  'font-lamah font-medium leading-[1.05] tracking-[-0.03em] ' +
                  (isCover ? 'text-[40px] sm:text-[64px]' : 'text-[28px] sm:text-[34px]')
                }
              >
                {isCover ? title : section.title}
              </h1>
              {section.intro && (
                <p className="max-w-[46ch] font-lamah text-[15px] leading-relaxed text-cream-dim">
                  {section.intro}
                </p>
              )}
              {!isCover && (
                <p className="hidden max-w-[38ch] font-lamah text-[13px] leading-relaxed text-cream-faint lg:block">
                  Answer what you can. Anything you skip we will pick up on the
                  call.
                </p>
              )}
            </div>

            <div className={isCover ? 'flex max-w-[58ch] flex-col gap-8' : 'flex flex-col gap-9'}>
              {section.blocks.map(block => {
                const value = answers[block.id]

                if (block.type === 'guidance') return <GuidanceBlock key={block.id} block={block} />
                if (block.type === 'select') {
                  return (
                    <SelectBlock
                      key={block.id} block={block}
                      value={typeof value === 'string' ? value : ''}
                      onChange={v => set(block.id, v)}
                    />
                  )
                }
                if (block.type === 'multi_select' || block.type === 'checkbox') {
                  return (
                    <MultiSelectBlock
                      key={block.id} block={block}
                      value={Array.isArray(value) ? value : []}
                      onChange={v => set(block.id, v)}
                    />
                  )
                }
                // short_text, long_text, link — and 'file' degrades to a text
                // note rather than a broken upload, since monthly forms carry no
                // storage bucket (a staff-added file block is out of scope for v1)
                return (
                  <TextBlock
                    key={block.id} block={block} long={block.type === 'long_text'}
                    value={typeof value === 'string' ? value : ''}
                    onChange={v => set(block.id, v)}
                  />
                )
              })}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-5 border-t border-cream/15 pt-8 lg:col-span-2">
              {step > 0 && (
                <button
                  type="button" onClick={() => void goto(step - 1)}
                  className="bg-transparent font-lamam text-[11px] uppercase tracking-widest text-cream-dim transition-colors hover:text-cream"
                >
                  ← Back
                </button>
              )}
              {reviewed && step < lastStep - 1 && (
                <button
                  type="button" onClick={() => void goto(lastStep)}
                  className="ml-auto bg-transparent font-lamam text-[11px] uppercase tracking-widest text-cream-dim transition-colors hover:text-cream"
                >
                  Skip to review
                </button>
              )}
              <button
                type="button" onClick={() => void goto(step + 1)}
                className={
                  'group inline-flex items-center gap-3 bg-cream px-7 py-3.5 ' +
                  'font-lamam text-[11px] uppercase tracking-widest text-ink ' +
                  'transition-opacity hover:opacity-85 ' +
                  (reviewed && step < lastStep - 1 ? '' : 'ml-auto')
                }
              >
                {isCover ? 'Begin' : step === lastStep - 1 ? 'Review' : 'Continue'}
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
