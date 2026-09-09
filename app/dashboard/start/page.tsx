'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Check, Eye, ExternalLink, ListChecks } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { clampStep, tutorialFor, tutorialKey } from '@/app/lib/tutorial-core'
import { useRole } from '../useRole'
import PageTitle from '../ui/PageTitle'

/**
 * HOW THIS WORKS — the first-day tutorial, one step at a time.
 *
 * Opened for a person the first time they sign in (the dashboard layout
 * sends them here until they press "I'm ready"), and kept in the sidebar so
 * it can be reopened. Each step says what you are looking at and then what
 * to do, with the real page one press away in a new tab so the tutorial is
 * still here when they come back.
 *
 * Progress within the tutorial is this browser's; "done" is the team_users
 * row, under the same per-role key the Getting started panels use, through
 * the same API. A promotion earns the new job's tutorial once.
 */
const STEP_KEY = 'md-tutorial-step'

export default function StartPage() {
  const router = useRouter()
  const { role, loading } = useRole()
  const tutorial = useMemo(() => tutorialFor(role), [role])
  const total = tutorial?.steps.length ?? 0

  const [step, setStep] = useState(0)
  const [ready, setReady] = useState(false)
  const [finishing, setFinishing] = useState(false)

  // resume where they left off — a tutorial that starts over every time is
  // one nobody finishes
  useEffect(() => {
    if (!tutorial) return
    // `?step=3` from a link beats the remembered place; read off the URL
    // here rather than through useSearchParams, which wants a Suspense
    // boundary at build time for what is one number
    const url = new URLSearchParams(window.location.search)
    const fromUrl = url.has('step') ? Number(url.get('step')) : NaN
    let saved = 0
    try { saved = Number(localStorage.getItem(`${STEP_KEY}:${role}`) ?? 0) } catch { /* private mode */ }
    setStep(clampStep(Number.isFinite(fromUrl) ? fromUrl : saved, total))
    setReady(true)
  }, [tutorial, total, role])

  const go = (next: number) => {
    const n = clampStep(next, total)
    setStep(n)
    try { localStorage.setItem(`${STEP_KEY}:${role}`, String(n)) } catch { /* private mode */ }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const finish = async () => {
    if (!tutorial || !role) return
    setFinishing(true)
    // "done" must always stick, or the layout keeps sending them back here:
    // the browser remembers it even when the database write fails
    try { localStorage.setItem(`md-tutorial-done:${role}`, '1') } catch { /* private mode */ }
    try {
      await fetch('/api/team/getting-started', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: 'start' }),
      })
    } catch { /* remembered locally above */ }
    router.push(tutorial.home)
  }

  if (loading || (role && tutorial && !ready)) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!tutorial) {
    return (
      <>
        <PageTitle title="How this works" />
        <p className="text-[14px] text-muted-foreground">There is no tutorial for this account.</p>
      </>
    )
  }

  const current = tutorial.steps[step]
  const last = step === total - 1

  return (
    <div className="mx-auto max-w-3xl" data-tutorial-role={role} data-tutorial-key={role ? tutorialKey(role) : ''}>
      <PageTitle
        title="How this works"
        summary={<><strong>{tutorial.job}</strong> {tutorial.intro}</>}
      />

      {/* where you are: one dot per step, the done ones ticked */}
      <ol className="mb-6 flex flex-wrap items-center gap-2" aria-label="Steps">
        {tutorial.steps.map((s, i) => (
          <li key={s.title}>
            <button
              type="button"
              onClick={() => go(i)}
              aria-current={i === step ? 'step' : undefined}
              title={s.title}
              className={`flex h-9 min-w-9 items-center justify-center rounded-full px-3 text-[13px] font-semibold transition-colors ${
                i === step
                  ? 'bg-foreground text-background'
                  : i < step
                    ? 'bg-foreground/[0.08] text-foreground'
                    : 'border border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {i < step ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
            </button>
          </li>
        ))}
      </ol>

      <section className="flex flex-col gap-6 rounded-card border border-border bg-surface p-5 sm:p-7" aria-labelledby="tutorial-step">
        <div className="flex flex-col gap-1">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Step {step + 1} of {total}
          </p>
          <h2 id="tutorial-step" className="text-section-title">{current.title}</h2>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            <Eye className="h-4 w-4" aria-hidden /> What you are looking at
          </h3>
          <ul className="flex flex-col gap-2 text-[15px] leading-[1.5]">
            {current.see.map(line => (
              <li key={line} className="flex gap-3">
                <span aria-hidden className="mt-[10px] h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/50" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            <ListChecks className="h-4 w-4" aria-hidden /> What to do
          </h3>
          <ol className="flex flex-col gap-2 text-[15px] leading-[1.5]">
            {current.actions.map((line, i) => (
              <li key={line} className="flex gap-3">
                <span aria-hidden className="mt-[2px] flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[12px] font-bold text-background">
                  {i + 1}
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ol>
        </div>

        {current.result && (
          <p className="rounded-inner bg-foreground/[0.04] px-4 py-3 text-[14px]">
            <span className="font-semibold">Then: </span>{current.result}
          </p>
        )}

        {current.href && (
          <Link
            href={current.href}
            target="_blank"
            rel="noopener"
            className="inline-flex w-fit min-h-11 items-center gap-2 text-[14px] font-semibold underline-offset-4 hover:underline"
          >
            {current.linkLabel ?? 'Open the page'} <ExternalLink className="h-4 w-4" aria-hidden />
            <span className="text-[12px] font-normal text-muted-foreground">(opens in a new tab, so this stays here)</span>
          </Link>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <Button variant="outline" className="h-11 rounded-full px-5" disabled={step === 0} onClick={() => go(step - 1)}>
            <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden /> Back
          </Button>
          <div className="flex items-center gap-3">
            {!last && (
              <button type="button" className="text-[13px] text-muted-foreground underline-offset-4 hover:underline" onClick={finish} disabled={finishing}>
                Skip for now
              </button>
            )}
            {last ? (
              <Button className="h-11 rounded-full bg-foreground px-6 text-[14px] font-semibold text-background hover:bg-foreground/90" onClick={finish} disabled={finishing}>
                {finishing ? 'One moment…' : `I’m ready — ${tutorial.homeLabel.replace(/^Open /, 'open ')}`}
              </Button>
            ) : (
              <Button className="h-11 rounded-full bg-foreground px-6 text-[14px] font-semibold text-background hover:bg-foreground/90" onClick={() => go(step + 1)}>
                Next <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden />
              </Button>
            )}
          </div>
        </div>
      </section>

      <p className="mt-4 text-[13px] text-muted-foreground">
        You can come back to this any time from <strong>How this works</strong> in the sidebar.
      </p>
    </div>
  )
}
