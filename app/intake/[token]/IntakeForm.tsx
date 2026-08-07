'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  completion, type Answers, type IntakeStatus, type TemplateDefinition,
} from '../../lib/intake-core'
import {
  GuidanceBlock, TextBlock, SelectBlock, MultiSelectBlock, FileBlock,
} from './blocks'

type FileRow = { block_id: string; filename: string; url: string }
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * The form the client fills in. Dark lama system, matching /work and /events.
 *
 * "Fill it in over a coffee, not in a rush" is in the instructions we send, so
 * it is a requirement rather than a pleasantry: every field autosaves and the
 * same link resumes exactly where they stopped. Nobody loses six hundred words
 * about their family's history to a closed tab.
 */
export default function IntakeForm({
  token, clientName, title, definition, initialAnswers, initialStatus, files: initialFiles,
}: {
  token: string
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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // the newest value per field, so a debounced flush sends what is on screen
  // rather than what was there when the timer started
  const pending = useRef<Answers>({})

  const locked = status === 'submitted'
  const progress = useMemo(() => completion(definition, answers), [definition, answers])
  const pct = progress.total === 0 ? 0 : Math.round((progress.answered / progress.total) * 100)

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

  const upload = useCallback(async (blockId: string, file: File) => {
    setUploading(blockId)
    try {
      const res = await fetch(`/api/intake/${token}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size, blockId }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const { signedUrl, publicUrl } = await res.json()
      // straight to storage — the file never passes through our server
      const put = await fetch(signedUrl, {
        method: 'PUT', headers: { 'Content-Type': file.type }, body: file,
      })
      if (!put.ok) throw new Error(`upload ${put.status}`)
      setFiles(prev => [...prev, { block_id: blockId, filename: file.name, url: publicUrl }])
      setSave('saved')
    } catch {
      setSave('error')
    } finally {
      setUploading(null)
    }
  }, [token])

  const submit = useCallback(async () => {
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

  return (
    <div className="min-h-screen bg-ink text-cream antialiased">
      {/* ── docked bar: identity left, save state right, progress hairline under ── */}
      <header className="sticky top-0 z-30 border-b border-cream/15 bg-ink/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-4 px-6">
          {/* same treatment as LamaNav: the PNG is already light on transparent,
              so any filter here destroys it */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/MDLogo-trim.png" alt="MD Media" className="h-5 w-auto" />
          <p className="hidden font-lamam text-[10px] uppercase tracking-widest text-cream-dim sm:block">
            {clientName}
          </p>
          <p
            className={
              'ml-auto font-lamam text-[10px] uppercase tracking-widest tabular-nums ' +
              (save === 'error' ? 'text-[#E2725B]' : 'text-cream-dim')
            }
          >
            {savedLabel}
          </p>
        </div>
        <div className="h-px w-full bg-cream/10">
          <div
            className="h-px bg-cream transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-16 px-6 py-16 sm:py-24">
        <div>
          <p className="font-lamam text-[10px] uppercase tracking-widest text-cream-dim">
            {title}
          </p>
          <h1 className="mt-5 font-lamah text-[38px] font-medium leading-[1.05] tracking-[-0.03em] sm:text-[54px]">
            Welcome to<br />MD Media.
          </h1>
          <p className="mt-6 max-w-[54ch] font-lamah text-[16px] leading-relaxed text-cream-dim">
            This is the foundation we build everything on: the brand, the shoot,
            the content, the strategy. Take your time. There are no wrong
            answers, only honest ones. Everything saves as you type, so you can
            close this and come back whenever suits.
          </p>
        </div>

        {locked && (
          <p className="max-w-[54ch] border-l border-cream pl-5 font-lamah text-[15px] leading-relaxed text-cream">
            Thank you. This is with us now. If you need to change something,
            tell your account manager and we will reopen it for you.
          </p>
        )}

        {definition.sections.map((section, i) => {
          const done = progress.sections[i]
          return (
            <section key={section.id} className="flex flex-col gap-8">
              <div className="flex flex-col gap-3 border-b border-cream/15 pb-5">
                <div className="flex items-baseline gap-4">
                  <span className="font-lamam text-[10px] tabular-nums tracking-widest text-cream-faint">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h2 className="font-lamah text-[22px] font-medium tracking-[-0.02em] sm:text-[26px]">
                    {section.title}
                  </h2>
                  {done && done.total > 0 && (
                    <span className="ml-auto font-lamam text-[10px] tabular-nums tracking-widest text-cream-faint">
                      {done.answered}/{done.total}
                    </span>
                  )}
                </div>
                {section.intro && (
                  <p className="max-w-[60ch] font-lamah text-[14px] leading-relaxed text-cream-dim">
                    {section.intro}
                  </p>
                )}
              </div>

              <fieldset disabled={locked} className="m-0 flex flex-col gap-10 border-0 p-0">
                {section.blocks.map(block => {
                  const value = answers[block.id]

                  if (block.type === 'guidance') {
                    return <GuidanceBlock key={block.id} block={block} />
                  }
                  if (block.type === 'file') {
                    return (
                      <FileBlock
                        key={block.id} block={block} disabled={locked}
                        uploading={uploading === block.id}
                        files={files.filter(f => f.block_id === block.id)}
                        onUpload={f => void upload(block.id, f)}
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
              </fieldset>
            </section>
          )
        })}

        {!locked && (
          <div className="border-t border-cream/15 pt-10">
            <p className="mb-7 max-w-[54ch] font-lamah text-[15px] leading-relaxed text-cream-dim">
              Incomplete is fine, send us what you have and we will work the
              rest out together on the call.
            </p>
            <button
              type="button" onClick={() => void submit()} disabled={submitting}
              className={
                'group inline-flex items-center gap-3 border border-cream px-8 py-4 ' +
                'font-lamam text-[11px] uppercase tracking-widest text-cream ' +
                'transition-colors hover:bg-cream hover:text-ink disabled:opacity-50'
              }
            >
              {submitting ? 'Sending' : 'Send to MD Media'}
              <span className="transition-transform group-hover:translate-x-1">↗</span>
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
