import type { CheckResult } from '../../../lib/report-v2/types'

/** REPORT V2 — the automatic checks: "Needs checking" in red first, then warnings, then what passed (folded) */
export default function ChecksPanel({ checks }: { checks: readonly CheckResult[] }) {
  const fails = checks.filter(c => !c.ok && c.level === 'fail')
  const warns = checks.filter(c => !c.ok && c.level === 'warn')
  const passed = checks.filter(c => c.ok)
  return (
    <section className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4" data-testid="checks">
      <h2 className="text-[16px] font-semibold">Automatic checks</h2>
      {fails.length > 0 && (
        <div className="rounded-md border border-accent-red/40 bg-accent-red/10 p-3">
          <div className="font-semibold text-accent-red">Needs checking ({fails.length})</div>
          <ul className="mt-1 list-disc pl-5 text-[13px]">{fails.map((c, i) => <li key={i}>{c.words}</li>)}</ul>
        </div>
      )}
      {warns.length > 0 && (
        <div className="rounded-md border border-border bg-muted/50 p-3">
          <div className="font-semibold">Worth a look ({warns.length})</div>
          <ul className="mt-1 list-disc pl-5 text-[13px]">{warns.map((c, i) => <li key={i}>{c.words}</li>)}</ul>
        </div>
      )}
      {!fails.length && !warns.length && <p className="text-[13px] text-accent-green">Every check passed.</p>}
      <details className="text-[13px]"><summary className="cursor-pointer text-muted-foreground">Passed ({passed.length})</summary>
        <ul className="mt-1 list-disc pl-5">{passed.map((c, i) => <li key={i}>{c.words}</li>)}</ul>
      </details>
    </section>
  )
}

/** REPORT V2 — the share box. In the preview sharing is off; it says whether the report COULD be shared, and why not */
export function ShareBox({ blockers }: { blockers: readonly string[] }) {
  return (
    <section className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4" data-testid="share">
      <h2 className="text-[16px] font-semibold">Share with the client</h2>
      {blockers.length
        ? <><p className="text-[13px] text-accent-red">Sharing is blocked until these are fixed or the figures are read again:</p>
          <ul className="list-disc pl-5 text-[13px]">{blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></>
        : <p className="text-[13px] text-accent-green">The checks would allow sharing.</p>}
      <p className="text-[12px] text-muted-foreground">Preview only — nothing is shared or saved from this page.</p>
    </section>
  )
}
