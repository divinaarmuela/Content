'use client'

import { useEffect, useState } from 'react'

/**
 * THE CARD IN TABS (the owner, 21 Sep 2026: "let's add nice tabs — comments,
 * brand, what happened — so we can see everything nicely and not just
 * scroll"). The editor's card, the designer's (the same card) and the post
 * approval card were one long column: the brief, the work, the comments and
 * the history under each other, the last of them a long way down.
 *
 * Only the bar lives here. Each card keeps its sections where they were and
 * wraps a group in `tabPanel(…)`: a hidden panel stays MOUNTED, so a comment
 * half written or a link half pasted is still there when its tab is opened
 * again. The tab a person was last on is remembered per card kind, in their
 * own browser.
 */
export type CardTab<K extends string = string> = { key: K; label: string; count?: number | null }

export function useCardTab<K extends string>(kind: string, keys: readonly K[], fallback: K): [K, (k: K) => void] {
  const [tab, setTab] = useState<K>(fallback)
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`card-tab:${kind}`) as K | null
      if (saved && keys.includes(saved)) setTab(saved)
    } catch { /* a private window: the fallback stands */ }
    // once, on mount: the keys are a constant of the card
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])
  const choose = (k: K) => {
    setTab(k)
    try { window.localStorage.setItem(`card-tab:${kind}`, k) } catch { /* not remembered, still chosen */ }
  }
  return [tab, choose]
}

/** `contents` keeps the group's sections laid out exactly as they were */
export const tabPanel = (open: boolean): string => (open ? 'contents' : 'hidden')

export default function CardTabs<K extends string>({ tabs, value, onChange, label }: {
  tabs: readonly CardTab<K>[]; value: K; onChange: (k: K) => void; label: string
}) {
  return (
    <div role="tablist" aria-label={label}
      className="sticky top-0 z-10 flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-card px-3 py-2">
      {tabs.map(t => {
        const on = t.key === value
        return (
          <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => onChange(t.key)}
            className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold ${on ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
            {t.label}
            {typeof t.count === 'number' && t.count > 0 && (
              <span className={`rounded-full px-1.5 font-mono text-[12px] tabular-nums ${on ? 'bg-background/20' : 'bg-foreground/10'}`}>{t.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
