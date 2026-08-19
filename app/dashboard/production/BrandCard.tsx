'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { BrandProfile } from '../../lib/brand-core'

/**
 * The client's brand guide, travelling with the job.
 *
 * Editors cut to it and schedulers caption in it, but neither role can open
 * the Clients page — so the essentials (palette, typefaces, voice) render on
 * the item itself, filled from whatever the brand scanner extracted on the
 * client's Brand tab. Renders nothing when no brand data exists.
 */
export default function BrandCard({ clientId }: { clientId: string }) {
  const [profile, setProfile] = useState<BrandProfile | null | 'none'>(null)

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

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm font-semibold">Client brand</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {(profile.colors?.length ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {profile.colors!.slice(0, 10).map((c, i) => (
              <button
                key={`${c.hex}-${i}`}
                type="button"
                title={`${c.name ?? ''} ${c.hex ?? ''} — click to copy`}
                onClick={() => c.hex && copy(c.hex, c.name || c.hex)}
                className="flex items-center gap-1.5 rounded-full border border-zinc-200 py-1 pl-1.5 pr-2.5 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
              >
                <span className="h-4 w-4 rounded-full border border-zinc-200 dark:border-zinc-700" style={{ background: c.hex }} />
                <span className="font-mono text-[11px]">{c.hex}</span>
              </button>
            ))}
          </div>
        )}
        {(profile.fonts?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {profile.fonts!.slice(0, 6).map((f, i) => (
              <Badge
                key={`${f.family}-${i}`}
                variant="outline"
                className="cursor-pointer font-normal text-zinc-600 dark:text-zinc-400"
                onClick={() => copy(f.family, f.family)}
                title={f.usage ?? 'click to copy'}
              >
                {f.family}{f.usage ? ` · ${f.usage}` : ''}
              </Badge>
            ))}
          </div>
        )}
        {profile.voice && (profile.voice.tone || profile.voice.description) && (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {profile.voice.tone && <span className="font-medium">{profile.voice.tone}. </span>}
            {profile.voice.description}
            {(profile.voice.keywords?.length ?? 0) > 0 && (
              <span className="text-zinc-400 dark:text-zinc-500"> — {profile.voice.keywords!.slice(0, 8).join(', ')}</span>
            )}
          </p>
        )}
        {(profile.dos_and_donts?.donts?.length ?? 0) > 0 && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            <span className="font-medium text-red-600 dark:text-red-400">Never:</span>{' '}
            {profile.dos_and_donts!.donts!.slice(0, 4).join(' · ')}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
