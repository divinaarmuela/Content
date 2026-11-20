'use client'

import { useState } from 'react'
import { SOCIAL_PLATFORMS, formatSocialHandles, parseSocialHandles, type Block } from '../../lib/intake-core'
import { BRAND_ASSET_WORDS, brandAssetProblem } from '../../lib/brand-assets-core'
import PlatformIcon from '../../dashboard/social/PlatformIcon'

/**
 * One renderer per block type, kept apart from IntakeForm so that file stays
 * about state and this one stays about markup.
 *
 * Dark lama system, matching /work and /events: ink ground, cream type,
 * Archivo for prose and Sometype for labels. Fields are underlines rather than
 * boxes, as on LamaContactForm.
 *
 * `text-base` on every input is load-bearing: anything under 16px makes iOS
 * Safari auto-zoom the page on focus, and on a form this long that reads as
 * the page lurching away from you.
 */

// Filled boxes rather than bare underlines. An underline field with no padding
// puts the caret hard against the edge and gives the eye nothing to aim at on a
// phone; it also fails to read as a field at all next to the chips. Same fill
// and border as an unselected chip, so the whole form is one system.
const FIELD =
  'w-full rounded-lg border border-cream/20 bg-cream/[0.06] px-4 py-3.5 ' +
  'font-lamah text-base leading-relaxed text-cream placeholder:text-cream-dim/50 ' +
  'transition-colors focus:border-cream/60 focus:bg-cream/[0.09] focus:outline-none ' +
  'disabled:opacity-50'

const LABEL = 'block font-lamam text-[10px] uppercase tracking-widest text-cream-dim'

// An unselected chip needs a fill of its own. Border-only on a dark ground
// reads as a row of plain white words, so nothing says "tappable" and nothing
// distinguishes chosen from not until you already know.
const CHIP =
  'inline-flex items-center gap-2 rounded-full border px-4 py-2 font-lamah text-base ' +
  'transition-colors disabled:opacity-50'
const CHIP_ON = 'border-cream bg-cream text-ink font-medium'
const CHIP_OFF =
  'border-cream/20 bg-cream/[0.06] text-cream-dim hover:border-cream/50 hover:bg-cream/10 hover:text-cream'

export function BlockLabel({ block }: { block: Block }) {
  return (
    <div className="mb-3">
      <label htmlFor={block.id} className={LABEL}>{block.label}</label>
      {block.help && (
        <p className="mt-2 max-w-[60ch] font-lamah text-[14px] leading-relaxed text-cream-dim">
          {block.help}
        </p>
      )}
    </div>
  )
}

export function GuidanceBlock({ block }: { block: Block }) {
  return (
    <p className="max-w-[62ch] border-l border-cream/25 pl-5 font-lamah text-[15px] leading-relaxed text-cream-dim">
      {block.label}
    </p>
  )
}

export function TextBlock({
  block, value, onChange, long,
}: {
  block: Block
  value: string
  onChange: (v: string) => void
  long?: boolean
}) {
  return (
    <div>
      <BlockLabel block={block} />
      {long ? (
        <textarea
          id={block.id} value={value} rows={5} placeholder={block.placeholder}
          onChange={e => onChange(e.target.value)}
          className={`${FIELD} resize-y leading-relaxed`}
        />
      ) : (
        <input
          id={block.id} type="text" value={value} placeholder={block.placeholder}
          onChange={e => onChange(e.target.value)}
          className={FIELD}
        />
      )}
    </div>
  )
}

export function SelectBlock({
  block, value, onChange,
}: { block: Block; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <BlockLabel block={block} />
      <div className="flex flex-wrap gap-2">
        {(block.options ?? []).map(opt => (
          <button
            key={opt} type="button" aria-pressed={value === opt}
            // clicking the chosen option again clears it — a select with no way
            // back is a trap when someone mis-taps on a phone
            onClick={() => onChange(value === opt ? '' : opt)}
            className={`${CHIP} ${value === opt ? CHIP_ON : CHIP_OFF}`}
          >
            {value === opt && <span>✓</span>}
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}

export function MultiSelectBlock({
  block, value, onChange,
}: { block: Block; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (opt: string) =>
    onChange(value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt])

  return (
    <div>
      <BlockLabel block={block} />
      <div className="flex flex-wrap gap-2">
        {(block.options ?? []).map(opt => {
          const on = value.includes(opt)
          return (
            <button
              key={opt} type="button" onClick={() => toggle(opt)}
              aria-pressed={on}
              className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}
            >
              {/* a tick, so "chosen" survives being read on a bad screen or by
                  someone who cannot separate the two fills by colour alone */}
              <span className={on ? 'opacity-100' : 'opacity-30'}>{on ? '✓' : '+'}</span>
              {opt}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * SOCIAL HANDLES (the owner, 20 Nov 2026: "selecting social media icons and providing the handle there, for each").
 * A row of the platforms' own marks to tap; each one tapped opens a box for its handle. What is picked is kept here
 * while they type — the answer that is saved holds only the platforms with a handle (intake-core.ts).
 */
export function SocialHandlesBlock({ block, value, onChange }: { block: Block; value: string; onChange: (v: string) => void }) {
  const [rows, setRows] = useState(() => parseSocialHandles(value))
  const put = (next: { platform: string; handle: string }[]) => { setRows(next); onChange(formatSocialHandles(next)) }
  const toggle = (key: string) => put(rows.some(r => r.platform === key) ? rows.filter(r => r.platform !== key) : [...rows, { platform: key, handle: '' }])
  const picked = SOCIAL_PLATFORMS.filter(p => rows.some(r => r.platform === p.key))
  return (
    <div>
      <BlockLabel block={block} />
      <div className="flex flex-wrap gap-2" role="group" aria-label={block.label}>
        {SOCIAL_PLATFORMS.map(p => {
          const on = rows.some(r => r.platform === p.key)
          return (
            <button key={p.key} type="button" onClick={() => toggle(p.key)} aria-pressed={on}
              className={`${CHIP} min-h-11 ${on ? CHIP_ON : CHIP_OFF}`}>
              <PlatformIcon platform={p.key} size={20} />
              {p.label}
              <span aria-hidden className={on ? 'opacity-100' : 'opacity-30'}>{on ? '✓' : '+'}</span>
            </button>
          )
        })}
      </div>
      {picked.length > 0 && (
        <div className="mt-4 flex flex-col gap-3">
          {picked.map(p => (
            <div key={p.key} className="flex items-center gap-3">
              <PlatformIcon platform={p.key} size={28} className="shrink-0" />
              <input
                id={`${block.id}-${p.key}`} type="text" inputMode="text" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                aria-label={`Your ${p.label} handle`} placeholder={`Your ${p.label} handle or link`}
                value={rows.find(r => r.platform === p.key)?.handle ?? ''}
                onChange={e => put(rows.map(r => (r.platform === p.key ? { ...r, handle: e.target.value } : r)))}
                className={FIELD}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * SEVERAL FILES, AND THE RULES SAID FIRST (the owner, 20 Nov 2026: "allow users to upload multiple files … put file
 * type and limit for each file size"; then "50 mb only??? … files are usually bigger"). The discovery form's upload
 * box takes what the client Brand tab takes (brand-assets-core.ts: 1 GB a file, the same kinds): pick any number of
 * files at once, the kinds and the size each may be are written under it, and a file that cannot be taken is named with the reason — it used
 * to just say "Not saved". Each file is sent in turn; the ones already sent are listed with a tick.
 */
export function MultiFileBlock({
  block, files, onUpload, uploading, disabled, onBusy,
}: {
  block: Block
  files: { filename: string; url: string }[]
  /** sends one file, reporting how far it has got (0 to 1); resolves true when it is kept */
  onUpload: (file: File, onProgress: (fraction: number) => void) => Promise<boolean>
  uploading: boolean
  disabled: boolean
  /** tells the form files are going up, so it can shut every way off the page until they are done */
  onBusy?: (busy: boolean) => void
}) {
  const [problems, setProblems] = useState<string[]>([])
  // THE LOADING STATE (the owner, 20 Nov 2026: "when files are uploading there is no loading state"): which file is
  // going up, how many are left, and how far this one has got
  const [sending, setSending] = useState<{ name: string; at: number; of: number; fraction: number } | null>(null)
  const pick = async (list: File[]) => {
    const bad: string[] = []
    const good: File[] = []
    for (const f of list) { const why = brandAssetProblem(f.name, f.size); if (why) bad.push(why); else good.push(f) }
    setProblems(bad)
    if (!good.length) return
    onBusy?.(true)
    try {
      for (let i = 0; i < good.length; i++) {
        const f = good[i]
        setSending({ name: f.name, at: i + 1, of: good.length, fraction: 0 })
        const kept = await onUpload(f, fraction => setSending(s => (s && s.name === f.name ? { ...s, fraction } : s)))
        if (!kept) bad.push(`“${f.name}” could not be uploaded. Please try it again.`)
      }
    } finally {
      setSending(null); setProblems([...bad]); onBusy?.(false)
    }
  }
  const busy = disabled || uploading || !!sending
  const pct = sending ? Math.min(100, Math.round(sending.fraction * 100)) : 0
  return (
    <div>
      <BlockLabel block={block} />
      {files.length > 0 && (
        <ul className="mb-4 flex list-none flex-col gap-1.5 p-0" aria-label="Files you have added">
          {files.map(f => (
            <li key={f.url} className="break-all font-lamam text-[12px] text-cream-dim">
              <span className="text-cream">✓</span> {f.filename}
            </li>
          ))}
        </ul>
      )}
      {sending ? (
        <div role="status" aria-live="polite" className="rounded-lg border border-solid border-cream/25 bg-cream/[0.06] p-4">
          <div className="flex items-center gap-3">
            <span aria-hidden className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-solid border-cream/25 border-t-cream" />
            <p className="min-w-0 flex-1 break-all font-lamah text-[15px] leading-snug text-cream">
              Uploading {sending.name}
            </p>
            <span className="shrink-0 font-lamam text-[12px] tabular-nums tracking-widest text-cream">{pct}%</span>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-cream/15" aria-hidden>
            <div className="h-full rounded-full bg-cream transition-[width] duration-200 ease-out" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-3 font-lamam text-[10px] uppercase tracking-widest text-cream-dim">
            {sending.of > 1 ? `File ${sending.at} of ${sending.of} · ` : ''}Keep this page open until it finishes
          </p>
        </div>
      ) : (
        <label className={`inline-flex min-h-12 cursor-pointer items-center gap-3 rounded-full border border-solid border-cream/25 bg-cream/[0.06] px-5 font-lamam text-[11px] uppercase tracking-widest text-cream transition-colors hover:border-cream ${busy ? 'pointer-events-none opacity-50' : ''}`}>
          <span aria-hidden>+</span> {files.length > 0 ? 'Add more files' : 'Choose files'}
          <input
            type="file" multiple disabled={busy} className="sr-only"
            onChange={e => { const list = [...(e.target.files ?? [])]; e.target.value = ''; if (list.length) void pick(list) }}
          />
        </label>
      )}
      <p className="mt-3 max-w-[60ch] font-lamah text-[14px] leading-relaxed text-cream-dim">We take {BRAND_ASSET_WORDS}. Up to 1 GB each, and you can add more than one.</p>
      {problems.length > 0 && (
        <ul role="alert" className="mt-3 flex list-none flex-col gap-1.5 p-0">
          {problems.map(p => <li key={p} className="font-lamah text-[14px] leading-relaxed text-[#E2725B]">{p}</li>)}
        </ul>
      )}
    </div>
  )
}
