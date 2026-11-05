import { redirect } from 'next/navigation'

/** /dashboard/reports/preview — the rebuilt report IS Reports now (the owner, 5 Nov 2026: "replace the current reports
 *  page with the new one"); an old preview link lands on Reports with its client, month and filters kept. */
export default async function ReportPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) for (const one of ([] as (string | undefined)[]).concat(v)) if (one) q.append(k, one)
  const s = q.toString()
  redirect(`/dashboard/reports${s ? `?${s}` : ''}`)
}
