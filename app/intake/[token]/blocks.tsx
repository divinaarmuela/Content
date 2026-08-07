'use client'

import type { Block } from '../../lib/intake-core'

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

export function FileBlock({
  block, files, onUpload, uploading, disabled,
}: {
  block: Block
  files: { filename: string; url: string }[]
  onUpload: (file: File) => void
  uploading: boolean
  disabled: boolean
}) {
  return (
    <div>
      <BlockLabel block={block} />
      {files.length > 0 && (
        <ul className="mb-4 flex flex-col gap-1">
          {files.map(f => (
            <li key={f.url} className="font-lamam text-[12px] text-cream-dim">
              <span className="text-cream">✓</span> {f.filename}
            </li>
          ))}
        </ul>
      )}
      <input
        type="file" disabled={disabled || uploading}
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) onUpload(f)
          e.target.value = '' // so the same file can be re-picked after a failure
        }}
        className={
          'font-lamam text-[12px] text-cream-dim file:mr-4 file:cursor-pointer ' +
          'file:rounded-full file:border file:border-cream/25 file:bg-transparent ' +
          'file:px-4 file:py-2 file:font-lamam file:text-[11px] file:uppercase ' +
          'file:tracking-widest file:text-cream hover:file:border-cream'
        }
      />
      {uploading && <p className="mt-3 font-lamam text-[11px] uppercase tracking-widest text-cream-dim">Uploading…</p>}
    </div>
  )
}
