/**
 * The heading block at the top of a dashboard page: a large title, an optional
 * one-line summary in plain words, and an optional slot for the page's own
 * buttons.
 *
 * Presentation only — no data, no state. Pages adopt it as they are restyled.
 */
export default function PageTitle({ title, summary, actions }: {
  title: string
  /** one plain sentence: what this page is for, not what it is called */
  summary?: string
  /** the page's own buttons, right-aligned on desktop and stacked on a phone */
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 pb-6 pt-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <h1 className="text-page-title-sm sm:text-page-title">{title}</h1>
        {summary && (
          <p className="mt-2 max-w-2xl text-[15px] text-muted-foreground">{summary}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
