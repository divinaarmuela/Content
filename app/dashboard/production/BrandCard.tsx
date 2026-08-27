'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Check, ChevronDown, ChevronUp, Copy, X } from 'lucide-react'
import type { BrandProfile } from '../../lib/brand-core'

/**
 * The client's brand guide, travelling with the job — a working reference,
 * not a summary. Editors cut to it and schedulers caption in it: the palette
 * is click-to-copy, typography carries usage and weights, voice reads in
 * full, and the do's/don'ts sit as a checklist. Sourced from the client's
 * Brand tab (the AI scan); renders nothing when no brand data exists.
 */

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">{children}</p>
)

export default function BrandCard({ clientId }: { clientId: string }) {
  const [profile, setProfile] = useState<BrandProfile | null | 'none'>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`/api/clients/${clientId}/brand`)
      .then(r => (r.ok ? r.json() : null))
      .then(json => {
        if (!alive) return
        const p = json?.profile as BrandProfile | undefined
        setProfile(p && Object.keys(p).length > 0 ? p : 'none')
      })
      .catch(() => alive && setProfile('none'))
    return () => { alive = false }
  }, [clientId])

  if (profile === null || profile === 'none') return null

  const copy = (text: string, label: string) => {
    void navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copied`),
      () => toast.error('Could not copy'),
    )
  }

  const hasRules =
    (profile.logo_rules?.length ?? 0) > 0 ||
    (profile.imagery?.length ?? 0) > 0 ||
    (profile.other_rules?.length ?? 0) > 0 ||
    (profile.dos_and_donts?.dos?.length ?? 0) > 0 ||
    (profile.dos_and_donts?.donts?.length ?? 0) > 0

  return (
    <Card>
      <CardHeader className="flex-row items-start">
        <div>
          <CardTitle className="text-sm font-semibold">Client brand</CardTitle>
          {profile.summary && (
            <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">{profile.summary}</p>
          )}
        </div>
        {hasRules && (
          <Button variant="ghost" size="sm" className="ml-auto shrink-0" onClick={() => setExpanded(e => !e)}>
            {expanded ? <>Less <ChevronUp className="h-3.5 w-3.5" /></> : <>Full guide <ChevronDown className="h-3.5 w-3.5" /></>}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-5 pt-0">
        {/* ── palette: real swatch tiles, click to copy ── */}
        {(profile.colors?.length ?? 0) > 0 && (
          <div className="flex flex-col gap-2">
            <SectionLabel>Palette</SectionLabel>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {profile.colors!.map((c, i) => (
                <button
                  key={`${c.hex}-${i}`}
                  type="button"
                  onClick={() => c.hex && copy(c.hex, c.name || c.hex)}
                  title="Click to copy the hex"
                  className="group overflow-hidden rounded-lg border border-zinc-200 text-left transition-shadow hover:shadow-md dark:border-zinc-800"
                >
                  <div className="h-12 w-full border-b border-zinc-100 dark:border-zinc-800" style={{ background: c.hex }} />
                  <div className="flex items-start justify-between gap-1 px-2.5 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{c.name || '—'}</p>
                      <p className="font-mono text-[11px] uppercase text-zinc-400 dark:text-zinc-500">{c.hex}</p>
                      {c.usage && <p className="mt-0.5 truncate text-[11px] text-zinc-400 dark:text-zinc-500">{c.usage}</p>}
                    </div>
                    <Copy className="mt-0.5 h-3 w-3 shrink-0 text-zinc-300 opacity-60 transition-opacity group-hover:opacity-100 dark:text-zinc-600" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── typography: family, role, weights ── */}
        {(profile.fonts?.length ?? 0) > 0 && (
          <div className="flex flex-col gap-2">
            <SectionLabel>Typography</SectionLabel>
            <div className="grid gap-2 sm:grid-cols-2">
              {profile.fonts!.map((f, i) => (
                <button
                  key={`${f.family}-${i}`}
                  type="button"
                  onClick={() => copy(f.family, f.family)}
                  title="Click to copy the family name"
                  className="group flex items-start justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2.5 text-left hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
                >
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold tracking-tight">{f.family}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {f.usage || 'Brand typeface'}
                      {(f.weights?.length ?? 0) > 0 && (
                        <span className="text-zinc-400 dark:text-zinc-500"> · {f.weights!.join(', ')}</span>
                      )}
                    </p>
                  </div>
                  <Copy className="mt-1 h-3 w-3 shrink-0 text-zinc-300 opacity-60 transition-opacity group-hover:opacity-100 dark:text-zinc-600" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── voice: tone chip, full description, keywords ── */}
        {profile.voice && (profile.voice.tone || profile.voice.description || (profile.voice.keywords?.length ?? 0) > 0) && (
          <div className="flex flex-col gap-2">
            <SectionLabel>Voice &amp; tone</SectionLabel>
            <div className="rounded-lg border border-zinc-200 px-3.5 py-3 dark:border-zinc-800">
              {profile.voice.tone && <p className="text-sm font-medium">{profile.voice.tone}</p>}
              {profile.voice.description && (
                <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{profile.voice.description}</p>
              )}
              {(profile.voice.keywords?.length ?? 0) > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {profile.voice.keywords!.map(k => (
                    <Badge key={k} variant="secondary" className="font-normal">{k}</Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── the full rulebook, folded until needed ── */}
        {expanded && hasRules && (
          <div className="flex flex-col gap-5">
            {((profile.dos_and_donts?.dos?.length ?? 0) > 0 || (profile.dos_and_donts?.donts?.length ?? 0) > 0) && (
              <div className="grid gap-3 sm:grid-cols-2">
                {(profile.dos_and_donts?.dos?.length ?? 0) > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <SectionLabel>Always</SectionLabel>
                    {profile.dos_and_donts!.dos!.map((d, i) => (
                      <p key={i} className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" /> {d}
                      </p>
                    ))}
                  </div>
                )}
                {(profile.dos_and_donts?.donts?.length ?? 0) > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <SectionLabel>Never</SectionLabel>
                    {profile.dos_and_donts!.donts!.map((d, i) => (
                      <p key={i} className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                        <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" /> {d}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
            {(profile.logo_rules?.length ?? 0) > 0 && (
              <div className="flex flex-col gap-1.5">
                <SectionLabel>Logo rules</SectionLabel>
                {profile.logo_rules!.map((r, i) => (
                  <p key={i} className="text-sm text-zinc-600 dark:text-zinc-300">· {r}</p>
                ))}
              </div>
            )}
            {(profile.imagery?.length ?? 0) > 0 && (
              <div className="flex flex-col gap-1.5">
                <SectionLabel>Imagery</SectionLabel>
                {profile.imagery!.map((r, i) => (
                  <p key={i} className="text-sm text-zinc-600 dark:text-zinc-300">· {r}</p>
                ))}
              </div>
            )}
            {(profile.other_rules?.length ?? 0) > 0 && (
              <div className="flex flex-col gap-1.5">
                <SectionLabel>Other rules</SectionLabel>
                {profile.other_rules!.map((r, i) => (
                  <p key={i} className="text-sm text-zinc-600 dark:text-zinc-300">· {r}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
