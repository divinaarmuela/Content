'use client'

import type { Block } from '../../lib/intake-core'

/**
 * One renderer per block type, kept apart from IntakeForm so that file stays
 * about state and this one stays about markup.
 *
 * Inputs are 16px throughout. Anything smaller makes iOS Safari zoom on focus,
 * and on a form this long that reads as the page lurching away from you.
 */

const FIELD =
  'w-full rounded-lg border border-[#C9C4BA] bg-white/70 px-4 py-3 text-[16px] ' +
  'text-[#0A0A0A] outline-none transition placeholder:text-[#8A8A85] ' +
  'focus:border-[#0057FF] focus:ring-2 focus:ring-[#0057FF]/20'

const CHIP_ON = 'border-[#0057FF] bg-[#0057FF] text-[#F4F0E6]'
const CHIP_OFF = 'border-[#C9C4BA] bg-white/70 text-[#5A5A55] hover:border-[#0A0A0A]'
const CHIP = 'rounded-full border px-4 py-2 text-[14px] transition disabled:opacity-60'

export function BlockLabel({ block }: { block: Block }) {
  return (
    <div className="mb-2">
      <label htmlFor={block.id} className="block text-[15px] font-medium leading-snug text-[#0A0A0A]">
        {block.label}
      </label>
      {block.help && (
        <p className="mt-1 text-[13px] leading-relaxed text-[#5A5A55]">{block.help}</p>
      )}
    </div>
  )
}

export function GuidanceBlock({ block }: { block: Block }) {
  return (
    <p className="border-l-2 border-[#0057FF] pl-4 text-[15px] leading-relaxed text-[#5A5A55]">
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
          id={block.id} value={value} rows={6} placeholder={block.placeholder}
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
            key={opt} type="button"
            // clicking the chosen option again clears it — a select with no
            // way back is a trap when someone mis-taps on a phone
            onClick={() => onChange(value === opt ? '' : opt)}
            className={`${CHIP} ${value === opt ? CHIP_ON : CHIP_OFF}`}
          >
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
        {(block.options ?? []).map(opt => (
          <button
            key={opt} type="button" onClick={() => toggle(opt)}
            className={`${CHIP} ${value.includes(opt) ? CHIP_ON : CHIP_OFF}`}
          >
            {opt}
          </button>
        ))}
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
        <ul className="mb-3 flex flex-col gap-1">
          {files.map(f => (
            <li key={f.url} className="font-mono text-[12px] text-[#5A5A55]">✓ {f.filename}</li>
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
          'text-[14px] text-[#5A5A55] file:mr-3 file:cursor-pointer file:rounded-full ' +
          'file:border file:border-[#C9C4BA] file:bg-white file:px-4 file:py-2 file:text-[13px]'
        }
      />
      {uploading && <p className="mt-2 text-[13px] text-[#5A5A55]">Uploading…</p>}
    </div>
  )
}
