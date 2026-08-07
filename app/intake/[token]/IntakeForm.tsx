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
 * The form the client fills in.
 *
 * "Fill it in over a coffee, not in a rush" is in the instructions we send, so
 * it is a requirement rather than a pleasantry: every field autosaves and the
 * same link resumes exactly where they stopped. Nobody loses six hundred words
 * about their family's history to a closed tab.
 */
export default function IntakeForm({
  token, definition, initialAnswers, initialStatus, files: initialFiles,
}: {
  token: string
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
    save === 'saving' ? 'Saving…'
    : save === 'error' ? 'Not saved — check your connection'
    : save === 'saved' ? 'Saved'
    : `${progress.answered} of ${progress.total}`

  return (
    <div className="min-h-screen bg-[#F4F0E6] text-[#0A0A0A] antialiased">
      <header className="sticky top-0 z-20 border-b border-[#C9C4BA] bg-[#F4F0E6]/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/MDLogo-trim.png" alt="MD Media" className="h-3.5 w-auto" />
          <p
            className={
              'ml-auto font-mono text-[10px] uppercase tracking-[0.15em] ' +
              (save === 'error' ? 'text-[#B42318]' : 'text-[#8A8A85]')
            }
          >
            {savedLabel}
          </p>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-12 px-5 py-12">
        <div>
          <h1 className="text-[34px] font-medium leading-[1.1] tracking-[-0.025em] sm:text-[42px]">
            Welcome to <span className="text-[#0057FF]">MD Media</span>.
          </h1>
          <p className="mt-4 max-w-[58ch] text-[16px] leading-relaxed text-[#5A5A55]">
            This form is the foundation we build everything on. Take your time —
            there are no wrong answers, only honest ones. Your work saves as you
            go, so you can close this and come back whenever suits.
          </p>
        </div>

        {locked && (
          <p className="rounded-lg border border-[#0057FF] bg-white/60 px-5 py-4 text-[15px] leading-relaxed">
            Thank you — this is with us now. If you need to change something,
            just tell your account manager and we will reopen it for you.
          </p>
        )}

        {definition.sections.map((section, i) => (
          <section key={section.id} className="flex flex-col gap-6">
            <div className="border-b border-[#C9C4BA] pb-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-[#8A8A85]">
                {String(i + 1).padStart(2, '0')}
              </p>
              <h2 className="mt-1 text-[20px] font-medium tracking-tight">{section.title}</h2>
              {section.intro && (
                <p className="mt-2 max-w-[62ch] text-[14px] italic leading-relaxed text-[#5A5A55]">
                  {section.intro}
                </p>
              )}
            </div>

            <fieldset disabled={locked} className="m-0 flex flex-col gap-7 border-0 p-0">
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
        ))}

        {!locked && (
          <div className="border-t border-[#C9C4BA] pt-8">
            <p className="mb-5 max-w-[58ch] text-[15px] leading-relaxed text-[#5A5A55]">
              Incomplete is fine — send us what you have and we will work the rest
              out together on the call.
            </p>
            <button
              type="button" onClick={() => void submit()} disabled={submitting}
              className={
                'bg-[#0057FF] px-7 py-4 font-mono text-[12px] font-semibold uppercase ' +
                'tracking-[0.15em] text-[#F4F0E6] transition hover:opacity-90 disabled:opacity-60'
              }
            >
              {submitting ? 'Sending…' : 'Send to MD Media →'}
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
