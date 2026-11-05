import 'server-only'
import { table } from '@/lib/db'
import type { ClientReport } from '@/lib/db-types'
import { includedIds, monthLabel, readReportData, type CandidatePost, type MonthKey, type PlatformFigures, type ReportData, includedPlatforms, scopeData } from './client-report-core'
import { readPostsExplained, type PostsExplained } from './post-breakdown-core'

/**
 * THE CLIENT'S REPORTS, ON THEIR PORTAL (Manal, via the owner, 5 Nov 2026: "a link we send to the client, they can view
 * how we do… interactive… put this on the client portal… monthly"). Only a month the team pressed "Share with client"
 * on is shown, and only what the client should read: the figures, the posts in the report, why they worked and the
 * written report. Never the team's notes, objective, checks, earlier versions, or what could not be read.
 */

export type PortalReportRow = { month: MonthKey; label: string; sharedAt: string }

export type PortalReport = {
  month: MonthKey
  label: string
  sharedAt: string
  platforms: PlatformFigures[]
  audience: ReportData['audience']
  /** the posts in this report, with their numbers */
  posts: CandidatePost[]
  explained: PostsExplained | null
  /** the written report, Markdown */
  body: string
}

export async function sharedReports(clientId: string): Promise<PortalReportRow[]> {
  const rows = await table<ClientReport>('client_reports').list({
    where: r => r.client_id === clientId && !!(r as { shared_at?: string | null }).shared_at && !!r.body,
  })
  return rows
    .map(r => ({ month: r.month as MonthKey, label: monthLabel(r.month as MonthKey), sharedAt: String((r as { shared_at?: string | null }).shared_at) }))
    .sort((a, b) => b.month.localeCompare(a.month))
}

export async function sharedReport(clientId: string, month: string): Promise<PortalReport | null> {
  const r = await table<ClientReport>('client_reports').get(`${clientId}_${month}`)
  const sharedAt = (r as { shared_at?: string | null } | null)?.shared_at
  if (!r || r.client_id !== clientId || !sharedAt || !r.body) return null
  const all = readReportData(r.data)
  if (!all) return null
  const data = scopeData(all, includedPlatforms(r.included_platforms, all.platforms.map(p => p.platform)))
  const picked = includedIds(r.included_post_ids, data.candidates ?? [])
  return {
    month: data.month,
    label: monthLabel(data.month),
    sharedAt: String(sharedAt),
    platforms: data.platforms,
    audience: data.audience,
    posts: (data.candidates ?? []).filter(c => picked.has(c.id)),
    explained: readPostsExplained(r.posts_explained),
    body: r.body,
  }
}
