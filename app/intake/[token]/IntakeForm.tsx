'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import BrandBackdrop from '../../components/BrandBackdrop'
import WorkPeek from './WorkPeek'
import {
  blockShown, completion, type Answers, type IntakeStatus, type TemplateDefinition,
} from '../../lib/intake-core'
import {
  GuidanceBlock, TextBlock, SelectBlock, MultiSelectBlock, MultiFileBlock, SocialHandlesBlock,
} from './blocks'

type FileRow = { block_id: string; filename: string; url: string }
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * The form the client fills in, one section per step.
 *
 * A step at a time rather than one long scroll: these forms run to sixteen
 * sections and eighty questions, and a single page of that reads as homework
 * before a word is typed. One section is a task somebody will actually start.
 *
 * "Fill it in over a coffee, not in a rush" is in the instructions we send, so
 * it is a requirement rather than a pleasantry: every field autosaves, and
 * coming back lands on the first section still missing answers instead of at
 * the top.
 */
export default function IntakeForm({
  token, clientName, title, definition, initialAnswers, initialStatus, files: initialFiles, backHref, discovery = false,
}: {
  token: string
  /**
   * THE DISCOVERY FORM WEARS ITS LANDING PAGE'S LOOK (the owner, 20 Nov 2026: "i want the form pages to be like the
   * landing page … but not the client intake form … make sure to not disturb existing intake form client functions").
   * True only for the discovery form. It changes what the page LOOKS like — the dotted field and drifting light, the
   * logo in the middle, the words on the thank-you screen — and that a visitor who has just read the landing page is
   * not shown a second welcome. Saving, uploading, the steps, the review and sending are the same code for every
   * form, and a client's intake form (this left false) is drawn exactly as it always was.
   */
  discovery?: boolean
  /** on the one portal: the way back to it (app/portal/[token]/home) */
  backHref?: string | null
  clientName: string
  title: string
  definition: TemplateDefinition
  initialAnswers: Answers
  initialStatus: IntakeStatus
  files: FileRow[]
}) {
  const [answers, setAnswers] = useState<Answers>(initialAnswers)
  const [status, setStatus] = useState<IntakeStatus>(initialStatus)
  const [files, setFiles] = useState<FileRow[]>(initialFiles)
  const [save, setSave] = useState<SaveState>('idle')
  const [uploading, setUploading] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // the discovery form's landing page has already welcomed them: it opens on the first questions
  const [step, setStep] = useState(discovery && definition.sections.length > 1 ? 1 : 0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // the newest value per field, so a debounced flush sends what is on screen
  // rather than what was there when the timer started
  const pending = useRef<Answers>({})

  const locked = status === 'submitted'
  const progress = useMemo(() => completion(definition, answers), [definition, answers])
  const pct = progress.total === 0 ? 0 : Math.round((progress.answered / progress.total) * 100)

  // steps = every section, then a review step at the end
  const lastStep = definition.sections.length
  const onReview = step === lastStep
  // Once they have seen the review step, going back to fill a missed section
  // must not mean walking every step again — a shortcut straight back appears.
  const [reviewed, setReviewed] = useState(false)
  useEffect(() => { if (onReview) setReviewed(true) }, [onReview])
  const section = definition.sections[step]
  /** A section of nothing but guidance is a cover, not a form page. The welcome
   *  note is the case: rendering it as a step with an empty question column
   *  reads as a page that failed to load. */
  const isCover = Boolean(section) && section.blocks.every(b => b.type === 'guidance')

  // Resume where they stopped: the first section with anything still missing.
  // Only on a return visit, so a first-timer always starts at the beginning.
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
      const res = await fetch(`/api/intake/${token}`, {
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
    // debounced rather than per-keystroke: these answers run to several hundred
    // words, and one request per character is neither kind nor necessary
    timer.current = setTimeout(() => void flush(), 800)
  }, [flush])

  // WHILE FILES ARE GOING UP, THE FORM STAYS PUT (the owner, 20 Nov 2026: "when files are uploading there is no loading
  // state and also users are able to move to other pages when uploading, make sure the button can't"). A file can be
  // 1 GB now, so the wait is real. The upload box says it is busy and how far each file has got; until it is done
  // every way off the page is shut — Continue, Back, the step bar, Send — and closing the tab asks first.
  const [uploadsBusy, setUploadsBusy] = useState(false)
  const busyNow = useRef(false)
  const markBusy = useCallback((busy: boolean) => { busyNow.current = busy; setUploadsBusy(busy) }, [])
  useEffect(() => {
    if (!uploadsBusy) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [uploadsBusy])

  /** Never leave a step without saving what is in it. */
  const goto = useCallback(async (next: number) => {
    // files still going up: the page does not change under them
    if (busyNow.current) return
    if (timer.current) clearTimeout(timer.current)
    await flush()
    setStep(Math.max(0, Math.min(lastStep, next)))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [flush, lastStep])

  // A NEW PAGE STARTS AT ITS TOP (the owner, 20 Nov 2026: "every time we move to the next question page on phone it's
  // taking us down the page instead of the top"). The gentle scroll above is started before the next page is drawn, and
  // a phone drops it when the page changes height under it. So once the new page IS drawn, the discovery form goes to
  // the top at once, and lets go of the box that was being typed in (which is what holds a phone's view down).
  useEffect(() => {
    if (!discovery) return
    const el = document.activeElement
    if (el instanceof HTMLElement && el !== document.body) el.blur()
    window.scrollTo(0, 0)
  // (only the step, and the form being sent in: a save in the middle of typing must never take the cursor away)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, status === 'submitted', discovery])

  const upload = useCallback(async (blockId: string, file: File, onProgress?: (fraction: number) => void) => {
    setUploading(blockId)
    try {
      const res = await fetch(`/api/intake/${token}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type || 'application/octet-stream', size: file.size, blockId }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const { signedUrl, publicUrl } = await res.json()
      // straight to storage, the file never passes through our server
      // (not fetch: only this way does the browser say how many bytes have gone, which is the loading bar)
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', signedUrl)
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
        xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(e.loaded / e.total) }
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload ${xhr.status}`)))
        xhr.onerror = () => reject(new Error('upload failed'))
        xhr.onabort = () => reject(new Error('upload stopped'))
        xhr.send(file)
      })
      onProgress?.(1)
      setFiles(prev => [...prev, { block_id: blockId, filename: file.name, url: publicUrl }])
      // mirror what the server just wrote into `answers`, so the progress
      // counter moves now rather than on the next page load
      setAnswers(prev => {
        const current = prev[blockId]
        const list = Array.isArray(current) ? current : []
        return list.includes(file.name) ? prev : { ...prev, [blockId]: [...list, file.name] }
      })
      setSave('saved')
      return true
    } catch {
      setSave('error')
      return false
    } finally {
      setUploading(null)
    }
  }, [token])

  /** takes one uploaded file back off the form; resolves true when it is gone */
  const removeFile = useCallback(async (blockId: string, file: { filename: string; url: string }) => {
    try {
      const res = await fetch(`/api/intake/${token}/upload`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: file.url }) })
      if (!res.ok) throw new Error(String(res.status))
      let left: FileRow[] = []
      setFiles(prev => { left = prev.filter(f => !(f.block_id === blockId && f.url === file.url)); return left })
      // the question's answer follows its files, so the count of what is answered moves at once
      setAnswers(prev => {
        const names = left.filter(f => f.block_id === blockId).map(f => f.filename)
        const next = { ...prev }
        if (names.length) next[blockId] = [...new Set(names)]; else delete next[blockId]
        return next
      })
      setSave('saved')
      return true
    } catch {
      setSave('error')
      return false
    }
  }, [token])

  const submit = useCallback(async () => {
    if (busyNow.current) return
    setSubmitting(true)
    if (timer.current) clearTimeout(timer.current)
    await flush()
    try {
      const res = await fetch(`/api/intake/${token}/submit`, { method: 'POST' })
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
      <div className={`flex min-h-screen flex-col items-center justify-center bg-ink px-6 text-cream ${discovery ? 'relative overflow-hidden py-16 [&>*:not([aria-hidden])]:relative [&>*:not([aria-hidden])]:z-10' : ''}`}>
        {discovery && <BrandBackdrop fixed />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/MDLogo-trim.png" alt="MD Media" className="mb-10 h-6 w-auto" />
        {backHref && <a href={backHref} className="mb-6 inline-flex min-h-11 items-center font-lamam text-[11px] uppercase tracking-widest text-cream-dim underline-offset-4 hover:underline">← Your portal</a>}
        <h1 className="max-w-[18ch] text-center font-lamah text-[34px] font-medium leading-[1.1] tracking-[-0.03em] sm:text-[44px]">
          Thank you. This is with us now.
        </h1>
        <p className="mt-6 max-w-[46ch] text-center font-lamah text-[16px] leading-relaxed text-cream-dim">
          {discovery
            // a potential client has no shoot or content plan yet: say what really happens next
            ? 'We will read every answer before we speak, and be in touch to find a time to talk. If something needs changing, email us at hello@mdmmarketing.com.au.'
            : 'We will read every word before the call, and come back with a shot list and a content plan built around it. If something needs changing, email us at hello@mdmmarketing.com.au and we will reopen it for you.'}
        </p>
        <p className="mt-10 font-lamam text-[10px] uppercase tracking-widest text-cream-faint">
          {progress.answered} of {progress.total} answered
        </p>
        {/* A SNEAK PEEK OF OUR WORK, their own industry's where we have it (Abby, via the owner, 20 Nov 2026) */}
        {discovery && <WorkPeek industry={typeof answers.industry === 'string' ? answers.industry : null} />}
      </div>
    )
  }

  return (
    <div className={`intake min-h-screen bg-ink text-cream antialiased ${discovery ? 'intake-disc relative' : ''}`}>
      {discovery && <BrandBackdrop fixed />}
      {/* THE BROWSER'S OWN EDGES AND BULLETS COME OFF (the owner, 20 Nov 2026, of the last page: "doesn't look nice by
          design … the button state is overlapping"). The site's reset covers only the dashboard, so here every button
          wore the browser's bevelled grey edge and every list its dots. Zero-weight rules, so each class still wins. */}
      {discovery && <style>{`:where(.intake-disc) :where(*,::before,::after){border-width:0;border-style:solid}:where(.intake-disc) :where(ul,ol){list-style:none;margin:0;padding:0}:where(.intake-disc) :where(button){padding:0;border-radius:0;appearance:none}`}</style>}
      {/* ── docked bar ── */}
      <header className={`sticky top-0 z-30 border-b border-cream/15 backdrop-blur ${discovery ? 'bg-ink/70' : 'bg-ink/95'}`}>
        {/* the discovery form: the logo in the middle, as on its landing page, and the count on the right */}
        {discovery ? (
          <div className="relative mx-auto flex h-16 max-w-5xl items-center px-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/MDLogo-trim.png" alt="MD Media" className="absolute left-1/2 top-1/2 h-5 w-auto -translate-x-1/2 -translate-y-1/2" />
            <p className={'ml-auto font-lamam text-[10px] uppercase tracking-widest tabular-nums ' + (save === 'error' ? 'text-[#E2725B]' : 'text-cream-dim')}>
              {savedLabel}<span className="hidden sm:inline">{save === 'idle' ? ' answered' : ''}</span>
            </p>
          </div>
        ) : (
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-6">
          {/* same treatment as LamaNav: the PNG is already light on transparent,
              so any filter here destroys it */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/MDLogo-trim.png" alt="MD Media" className="h-5 w-auto" />
          {backHref && <a href={backHref} className="inline-flex min-h-11 items-center font-lamam text-[10px] uppercase tracking-widest text-cream-dim underline-offset-4 hover:underline">← Your portal</a>}
          <p className="hidden font-lamam text-[10px] uppercase tracking-widest text-cream-dim sm:block">
            {clientName || title}
          </p>
          <p
            className={
              'ml-auto font-lamam text-[10px] uppercase tracking-widest tabular-nums ' +
              (save === 'error' ? 'text-[#E2725B]' : 'text-cream-dim')
            }
          >
            {/* a bare "1 / 80" says nothing about what is being counted */}
            {savedLabel}{save === 'idle' ? ' answered' : ''}
          </p>
        </div>
        )}
        <div className="h-px w-full bg-cream/10">
          <div className="h-px bg-cream transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
        </div>
      </header>

      <main className={`mx-auto w-full max-w-5xl px-6 py-12 sm:py-16 ${discovery ? 'relative z-10' : ''}`}>
        {/* Step rail. A plain <div>, NOT <nav>: globals.css styles bare nav
            elements for the marketing site (cream ground, borders), and this
            page shares that stylesheet — CLAUDE.md trap 2. */}
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
                is genuinely fine. Send us what you have and we will work the rest
                out together on the call.
              </p>
            </div>

            <ul className={discovery ? 'flex flex-col border-y border-cream/15 [&>li+li]:border-t [&>li+li]:border-cream/15' : 'flex flex-col divide-y divide-cream/10 border-y border-cream/10'}>
              {definition.sections.map((s, i) => {
                const done = progress.sections[i]
                if (done.total === 0) return null
                return (
                  <li key={s.id}>
                    <button
                      type="button" onClick={() => void goto(i)}
                      className={`group flex w-full items-center gap-4 text-left ${discovery ? 'min-h-[60px] py-4' : 'py-4'}`}
                    >
                      <span className="font-lamam text-[10px] tabular-nums tracking-widest text-cream-faint">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className={`font-lamah transition-colors group-hover:text-cream ${discovery ? 'text-[17px] text-cream' : 'text-[15px] text-cream-dim'}`}>
                        {s.title}
                      </span>
                      <span
                        className={
                          'ml-auto font-lamam text-[10px] tabular-nums tracking-widest ' +
                          (done.answered === done.total ? 'text-cream' : 'text-cream-faint')
                        }
                      >
                        {discovery && done.answered === done.total ? '✓ ' : ''}{done.answered}/{done.total}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>

            <div className={discovery ? 'flex flex-col-reverse items-stretch gap-4 sm:flex-row-reverse sm:items-center sm:justify-end sm:gap-6' : 'flex flex-wrap items-center gap-5'}>
              <button
                type="button" onClick={() => void submit()} disabled={submitting}
                className={
                  'group inline-flex items-center gap-3 bg-cream px-8 py-4 font-lamam ' +
                  'text-[11px] uppercase tracking-widest text-ink transition-opacity ' +
                  'hover:opacity-85 disabled:opacity-50' +
                  // the discovery form: the one action, full width on a phone, as on its landing page
                  (discovery ? ' order-last min-h-[56px] justify-center text-[12px] tracking-[0.2em] sm:order-none' : '')
                }
              >
                {submitting ? 'Sending' : 'Send to MD Media'}
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </button>
              <button
                type="button" onClick={() => void goto(lastStep - 1)} disabled={discovery && submitting}
                className={`bg-transparent font-lamam text-[11px] uppercase tracking-widest text-cream-dim transition-colors hover:text-cream ${discovery ? 'min-h-11 disabled:opacity-40' : ''}`}
              >
                ← Back
              </button>
            </div>
          </div>
        ) : (
          /* ── one section ── */
          <div className={isCover ? 'flex flex-col gap-10' : 'grid gap-12 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] lg:gap-16'}>
            {/* On a normal step this column is sticky beside the questions, so
                the section you are answering stays named while you scroll. A
                cover step has no questions, so it runs full width instead. */}
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
                {section.title}
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
                // a question that waits on another's answer is not drawn until it has it (no client's form has one)
                if (!blockShown(block, answers)) return null
                const value = answers[block.id]

                if (block.type === 'guidance') return <GuidanceBlock key={block.id} block={block} />
                // SEVERAL FILES, AND THE RULES SAID FIRST — on every intake form (the owner, 20 Nov 2026: "make sure
                // normal intake form does the same, for all 4 options"): the Brand tab's kinds and its 1 GB a file
                if (block.type === 'file') {
                  return (
                    <MultiFileBlock
                      key={block.id} block={block} disabled={false}
                      uploading={uploading === block.id}
                      files={files.filter(f => f.block_id === block.id)}
                      onUpload={(f, onProgress) => upload(block.id, f, onProgress)}
                      onBusy={markBusy}
                      onRemove={f => removeFile(block.id, f)}
                    />
                  )
                }
                if (block.type === 'select') {
                  return (
                    <SelectBlock
                      key={block.id} block={block}
                      value={typeof value === 'string' ? value : ''}
                      onChange={v => set(block.id, v)}
                    />
                  )
                }
                if (block.type === 'social_handles') {
                  return (
                    <SocialHandlesBlock
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
                  type="button" onClick={() => void goto(step - 1)} disabled={uploadsBusy}
                  // explicit background: the marketing stylesheet is shared with
                  // this page, so a bare button cannot be left to inherit
                  className="bg-transparent font-lamam text-[11px] uppercase tracking-widest text-cream-dim transition-colors hover:text-cream"
                >
                  ← Back
                </button>
              )}
              {reviewed && step < lastStep - 1 && (
                <button
                  type="button" onClick={() => void goto(lastStep)} disabled={uploadsBusy}
                  className="ml-auto bg-transparent font-lamam text-[11px] uppercase tracking-widest text-cream-dim transition-colors hover:text-cream"
                >
                  Skip to review
                </button>
              )}
              <button
                type="button" onClick={() => void goto(step + 1)} disabled={uploadsBusy} aria-busy={uploadsBusy}
                className={
                  'group inline-flex items-center gap-3 bg-cream px-7 py-3.5 ' +
                  'font-lamam text-[11px] uppercase tracking-widest text-ink ' +
                  'transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50 ' +
                  (reviewed && step < lastStep - 1 ? '' : 'ml-auto')
                }
              >
                {uploadsBusy ? 'Uploading your files…' : isCover ? 'Begin' : step === lastStep - 1 ? 'Review' : 'Continue'}
                {!uploadsBusy && <span className="transition-transform group-hover:translate-x-1">→</span>}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
