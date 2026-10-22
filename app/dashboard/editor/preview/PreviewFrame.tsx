'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { RefreshCw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import PageTitle from '../../ui/PageTitle'
import { useRole } from '../../useRole'
import { SCAN_STEPS } from '../../../lib/drive-scan-core'

const SCAN_STEP_LIST = SCAN_STEPS

/**
 * THE EDITOR PREVIEW'S FRAME — its title, the Preview badge, its own child pages (Board · AI scans) and "Check Drive
 * now". Super admins only while it is walked; the live Editor page is untouched (the owner, 21 Oct 2026).
 */
const TABS = [
  { href: '/dashboard/editor/preview', label: 'Board' },
  { href: '/dashboard/editor/preview/scans', label: 'AI scans' },
]

export function usePreviewAccess(everyone = false) {
  const { me } = useRole()
  // the card page is the Editor's card for the whole team now (22 Oct 2026); the board and AI scans stay super admin
  return { me, loading: !me, allowed: everyone ? !!me && me.role !== 'client' : me?.role === 'super_admin' }
}

export default function PreviewFrame({ title, summary, children, tabs = true, classicHref = null }: {
  title?: string
  summary?: React.ReactNode
  children: React.ReactNode
  tabs?: boolean
  /** the Editor's card page: open to the team, no Preview badge, and a way back to the old card ("Classic view") */
  classicHref?: string | null
}) {
  const path = usePathname()
  const { loading, allowed, me } = usePreviewAccess(!!classicHref)
  const manager = me?.role === 'super_admin' || me?.role === 'account_manager'
  const [checking, setChecking] = useState(false)
  const checkNow = async () => {
    setChecking(true)
    try {
      const res = await fetch('/api/editor-preview/check', { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Could not check Drive')
      toast.success(`Checked ${j.read} of ${j.sources} Drive links — ${j.seen} new ${j.seen === 1 ? 'file' : 'files'}`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not check Drive') } finally { setChecking(false) }
  }

  if (loading) return <div className="flex flex-col gap-3 pt-6"><Skeleton className="h-10 w-64" /><Skeleton className="h-64 w-full" /></div>
  if (!allowed) return <p className="pt-10 text-[15px] text-muted-foreground">{classicHref ? 'This card is for the team.' : 'The new Editor is in preview — only super admins can open it for now.'}</p>

  return (
    <div className="flex flex-col">
      <PageTitle
        title={title ?? 'Editor'}
        summary={summary ?? (
          <>Drive links are the inbox; the app keeps the versions. <span className="inline-flex items-center gap-1 font-semibold text-accent-blue-deep"><Sparkles className="h-3.5 w-3.5" aria-hidden />AI</span> checks every new or changed file against the card’s videos, and a person confirms.</>
        )}
        actions={<>
          {!classicHref && <Badge variant="outline" className="font-mono text-[12px] uppercase tracking-wider text-muted-foreground">Preview</Badge>}
          {/* not on a card (the owner, 22 Oct 2026: "we are not using ai anymore") — the card's files come from its own upload */}
          {manager && !classicHref && (
            <Button variant="outline" onClick={checkNow} disabled={checking} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} aria-hidden /> {checking ? 'Checking Drive…' : 'Check Drive now'}
            </Button>
          )}
          {/* no "Classic view" on a card (the owner, 22 Oct 2026: "remove classic view") — the new card is the card */}
          {!classicHref && <Button asChild variant="ghost"><Link href="/dashboard/editor">Back to the live Editor</Link></Button>}
        </>}
      />
      {tabs && (
        <nav aria-label="Editor preview" className="-mt-2 mb-5 flex gap-1 border-b border-border">
          {TABS.map(t => {
            const on = t.href === '/dashboard/editor/preview' ? path === t.href : path.startsWith(t.href)
            return (
              <Link key={t.href} href={t.href} aria-current={on ? 'page' : undefined}
                className={`-mb-px border-b-2 px-3 py-2.5 text-[14px] font-semibold ${on ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
                {t.label}
              </Link>
            )
          })}
        </nav>
      )}
      {children}
    </div>
  )
}

/** THE AI IS LOOKING — the one mark used everywhere a file is being scanned, so nobody wonders */
export function AiScanning({ n, className = '' }: { n: number; className?: string }) {
  if (n <= 0) return null
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full bg-accent-blue/15 px-2.5 py-1 text-[12px] font-semibold text-accent-blue-deep ${className}`}>
      <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-blue opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-accent-blue" /></span>
      <Sparkles className="h-3.5 w-3.5" aria-hidden /> AI scanning {n} {n === 1 ? 'file' : 'files'}
    </span>
  )
}

/**
 * THE SCAN, STEP BY STEP (the owner, 21 Oct 2026: "build a nice ui to show whats happening and its automated"): each
 * file shows its steps lighting up as the scan runs — measuring, sound, frames, colour, the AI — live from its row.
 */
export function ScanSteps({ state, steps }: { state: string; steps?: Record<string, string> | null }) {
  const queued = state === 'new'
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="AI scan steps">
      {SCAN_STEP_LIST.map((s, i) => {
        const st = queued ? 'waiting' : (steps?.[s.key] ?? (state === 'scanning' ? 'waiting' : 'done'))
        const tone = st === 'done' ? 'bg-tint-green text-foreground' : st === 'running' ? 'bg-accent-blue/15 text-accent-blue-deep' : st === 'failed' ? 'bg-tint-red' : st === 'skipped' ? 'bg-muted text-muted-foreground line-through' : 'bg-muted text-muted-foreground'
        return (
          <li key={s.key} className="flex items-center gap-1.5" title={s.words}>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
              {st === 'running' && <span className="h-1.5 w-1.5 animate-ping rounded-full bg-accent-blue" aria-hidden />}
              {st === 'done' && <span aria-hidden>✓</span>}
              {s.label}
            </span>
            {i < SCAN_STEP_LIST.length - 1 && <span aria-hidden className="h-px w-2 bg-border" />}
          </li>
        )
      })}
      {queued && <span className="text-[11px] text-muted-foreground">queued for the AI</span>}
    </ol>
  )
}
