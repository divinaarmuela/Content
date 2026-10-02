import Link from 'next/link'

/**
 * THE MINI PAGES' LIST (the owner, 2 Oct 2026: "each tab has like mini pages — October shoot, November shoot…").
 * One row per thing: its name, one line under it, a state chip, and the row opens its own page inside the tab.
 * Used for shoots, boards and the Scheduling tab's pieces of work, so every list reads the same.
 */
export type ListRow = {
  key: string
  href: string
  title: string
  line?: string | null
  /** 'waiting' is the client's to do; 'done' is answered; 'quiet' is information */
  chip?: { words: string; tone: 'waiting' | 'done' | 'quiet' } | null
}

const CHIP: Record<'waiting' | 'done' | 'quiet', string> = {
  waiting: 'bg-foreground text-background',
  done: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  quiet: 'bg-muted text-muted-foreground',
}

export default function OnePortalList({ heading, rows, empty }: { heading?: string; rows: ListRow[]; empty?: string }) {
  return (
    <section className="flex flex-col gap-2" data-one-portal-list={heading ?? 'list'}>
      {heading && <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{heading}</p>}
      {rows.length === 0 ? (
        empty ? <p className="rounded-inner border border-dashed border-border px-4 py-8 text-center text-[14px] text-muted-foreground">{empty}</p> : null
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-card border border-border bg-card">
          {rows.map(r => (
            <li key={r.key}>
              <Link href={r.href} className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted" data-row={r.key}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{r.title}</span>
                  {r.line && <span className="block truncate text-[13px] text-muted-foreground">{r.line}</span>}
                </span>
                {r.chip && <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${CHIP[r.chip.tone]}`}>{r.chip.words}</span>}
                <span aria-hidden className="shrink-0 text-muted-foreground">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
