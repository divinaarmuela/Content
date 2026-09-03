'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Compass } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  dismissKey, panelForPage, shouldShowPagePanel, type GettingStartedPage,
} from '@/app/lib/getting-started-core'
import type { Role } from '@/app/lib/identity-core'

/**
 * The first thing a new hire sees, and the only onboarding in the product.
 *
 * Three steps for their role ON THIS PAGE, each ending in a real link — a
 * tutorial that cannot send you somewhere that does not exist. Dismissed per
 * person, per role AND per page, so a promotion re-earns each panel once.
 *
 * It renders nothing at all until the dismissal state is known, because a
 * panel that flashes in and vanishes on every page load is worse than no
 * panel. It also renders nothing for roles with no panel (clients).
 *
 * Storage is the team_users row (docs/schema-history/getting_started.sql and
 * getting_started_pages.sql). If the pages field has never been written yet
 * the dismissal is remembered in this browser instead — "Got it" must always
 * stick, or people stop pressing it.
 */
const LOCAL_KEY = 'md-getting-started-dismissed'

function localDismissed(): string[] {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') } catch { return [] }
}

export default function GettingStarted({ role, page = 'overview' }: {
  role: Role | null
  page?: GettingStartedPage
}) {
  const [state, setState] = useState<{ dismissedRole: string | null; dismissedPages: string[] } | 'unknown' | undefined>(undefined)
  const [gone, setGone] = useState(false)

  useEffect(() => {
    let live = true
    fetch('/api/team/getting-started')
      .then(r => r.ok ? r.json() : { dismissedRole: null, dismissedPages: [] })
      .then(j => {
        if (!live) return
        setState({
          dismissedRole: j.dismissedRole ?? null,
          dismissedPages: [...(Array.isArray(j.dismissedPages) ? j.dismissedPages : []), ...localDismissed()],
        })
      })
      // help that cannot load is help that stays quiet
      .catch(() => { if (live) setState('unknown') })
    return () => { live = false }
  }, [])

  const panel = panelForPage(page, role)
  if (gone || panel === null || role === null || state === undefined || state === 'unknown') return null
  if (!shouldShowPagePanel(page, role, state.dismissedRole, state.dismissedPages)) return null

  const dismiss = () => {
    setGone(true)
    const key = dismissKey(page, role)
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify([...new Set([...localDismissed(), key])])) } catch { /* private mode */ }
    void fetch('/api/team/getting-started', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page }),
    }).catch(() => {})
  }

  return (
    <section className="mb-1 rounded-card border border-accent-blue/25 bg-tint-blue p-4 sm:p-5"
      aria-label="Getting started">
      <div className="flex items-start gap-2.5">
        <Compass className="mt-0.5 h-4 w-4 shrink-0 text-accent-blue-deep" />
        <h2 className="text-body-15 font-semibold text-foreground">{panel.heading}</h2>
      </div>

      <ol className="mt-4 grid gap-4 sm:grid-cols-3">
        {panel.steps.map((step, i) => (
          <li key={step.title} className="flex flex-col gap-1.5">
            <p className="text-body-15 font-medium">
              <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent-blue text-[12px] font-semibold text-white">
                {i + 1}
              </span>
              {step.title}
            </p>
            <p className="text-secondary-13 leading-relaxed text-muted-foreground">{step.body}</p>
            {step.href && step.linkLabel && (
              <Link
                href={step.href}
                className="mt-auto inline-flex min-h-11 items-center gap-1 text-secondary-13 font-medium text-foreground hover:underline"
              >
                {step.linkLabel} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </li>
        ))}
      </ol>

      <div className="mt-2 flex justify-end">
        <Button variant="outline" size="sm" className="min-h-11" onClick={dismiss}>Got it</Button>
      </div>
    </section>
  )
}
