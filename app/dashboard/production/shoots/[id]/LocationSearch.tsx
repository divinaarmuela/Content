'use client'

import { useEffect, useRef, useState } from 'react'
import { MapPin } from 'lucide-react'
import { Input } from '@/components/ui/input'

type Place = { label: string; detail: string }

/**
 * Location field with real place search — type and pick from a list instead
 * of hand-writing an address. Backed by Photon (komoot's public OSM geocoder:
 * free, no key, fine for this volume), biased toward Melbourne. Free text
 * still works — "Studio" or "TBC" saves exactly as typed.
 */
export default function LocationSearch({
  value, disabled, onSave,
}: {
  value: string
  disabled?: boolean
  onSave: (v: string) => void
}) {
  const [text, setText] = useState(value)
  const [open, setOpen] = useState(false)
  const [places, setPlaces] = useState<Place[]>([])
  const pickedRef = useRef(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setText(value) }, [value])

  useEffect(() => {
    if (disabled || pickedRef.current) { pickedRef.current = false; return }
    const q = text.trim()
    if (q.length < 3 || q === value) { setPlaces([]); setOpen(false); return }
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en&lat=-37.8136&lon=144.9631`,
          { signal: AbortSignal.timeout(5000) },
        )
        if (!res.ok) return
        const json = await res.json() as { features?: { properties?: Record<string, string> }[] }
        const seen = new Set<string>()
        const out: Place[] = []
        for (const f of json.features ?? []) {
          const p = f.properties ?? {}
          const name = p.name || [p.housenumber, p.street].filter(Boolean).join(' ')
          if (!name) continue
          const detail = [p.street && p.name ? p.street : '', p.district || p.city, p.state, p.country === 'Australia' ? '' : p.country]
            .filter(Boolean).join(', ')
          const label = detail ? `${name}, ${detail}` : name
          if (seen.has(label)) continue
          seen.add(label)
          out.push({ label, detail })
        }
        setPlaces(out)
        setOpen(out.length > 0)
      } catch { /* search is a convenience — typing still works */ }
    }, 350)
    return () => window.clearTimeout(t)
  }, [text, value, disabled])

  // close when clicking anywhere else
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [])

  const commit = (v: string) => {
    const next = v.trim()
    setOpen(false)
    if (next !== value) onSave(next)
  }

  return (
    <div ref={boxRef} className="relative">
      <MapPin className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
      <Input
        value={text}
        disabled={disabled}
        placeholder={'Search a place, or type "Studio" / "TBC"'}
        className="pl-8 text-sm"
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(text) } if (e.key === 'Escape') setOpen(false) }}
        onBlur={() => { if (!open) commit(text) }}
      />
      {open && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-md dark:border-zinc-800 dark:bg-zinc-900">
          {places.map(p => (
            <button
              key={p.label}
              type="button"
              className="flex w-full items-start gap-2 px-2.5 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
              onClick={() => { pickedRef.current = true; setText(p.label); commit(p.label) }}
            >
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
              <span className="min-w-0">
                <span className="block truncate">{p.label.split(',')[0]}</span>
                {p.detail && <span className="block truncate text-xs text-zinc-400">{p.detail}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
