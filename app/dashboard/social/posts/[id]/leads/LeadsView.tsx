'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { BadgeCheck, Download, ExternalLink, Lock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import PageTitle from '../../../../ui/PageTitle'
import Chip, { type ChipTone } from '../../../../ui/Chip'
import ReadPeopleButton from '../ReadPeopleButton'
import type { PostLeadsData } from '../../../../../lib/post-leads'
import { shortDay } from '@/app/lib/followers-core'
import { reachedOutWords } from '@/app/lib/people-analytics-core'
import {
  leadsCsv, leadsSummary, VERDICT_MEANS, VERDICT_SHORT, VERDICT_WORDS, type LeadVerdict,
} from '@/app/lib/post-leads-core'

/**
 * WHO THIS POST BROUGHT IN — the screen.
 *
 * The owner's question, 8 Sep 2026: for one post, cross-check the account's
 * inbox, the people who liked or commented, and the follower list — new
 * follower or existing — and only then call somebody a lead. Every count is
 * a filter; the legend under the table says exactly what each verdict rests
 * on, so the page never claims more than the dates support.
 */

const TONE: Record<LeadVerdict, ChipTone> = {
  lead: 'green', reached_out: 'amber', other_post: 'muted', existing: 'muted', not_following: 'surface', left: 'red',
}
const ORDER: LeadVerdict[] = ['lead', 'reached_out', 'other_post', 'existing', 'not_following', 'left']

export default function LeadsView({ data }: { data: PostLeadsData }) {
  const router = useRouter()
  const [focus, setFocus] = useState<LeadVerdict | 'all'>('all')
  const [checking, setChecking] = useState(false)
  const rows = useMemo(
    () => (focus === 'all' ? data.rows : data.rows.filter(r => r.verdict === focus)),
    [data.rows, focus],
  )
  const postHref = `/dashboard/social/posts/${encodeURIComponent(data.post.id)}`

  /** the Inbox stores nothing — its listing is what writes the "reached
   *  out" notes, so this loads it once, then re-reads the page */
  const checkInbox = async () => {
    setChecking(true)
    try {
      const res = await fetch('/api/social/messages')
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(json.error ?? 'Could not read the inbox')
      }
      toast.success('Inbox checked — the "Reached out" column is up to date.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not read the inbox')
    } finally {
      setChecking(false)
    }
  }

  const download = () => {
    const blob = new Blob([leadsCsv(data.rows)], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(data.item.title ?? 'post').replace(/[^\w-]+/g, '-')}-leads.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const readAt = data.people_read_at
    ? new Date(data.people_read_at).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', dateStyle: 'medium', timeStyle: 'short' })
    : null

  return (
    <div className="flex flex-col gap-4 pb-10">
      <PageTitle
        title={`Who "${data.item.title ?? 'this post'}" brought in`}
        summary={leadsSummary(data.counts, data.post_day)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={postHref}>Back to the post</Link>
            </Button>
            {data.may_read_people && data.analytics && (
              <ReadPeopleButton
                postId={data.post.id}
                analyticsId={data.analytics.id}
                running={data.people_status === 'running'}
                readBefore={data.people_read_at !== null}
              />
            )}
            <Button variant="outline" size="sm" disabled={checking} onClick={() => void checkInbox()}>
              {checking ? 'Checking…' : 'Check the inbox now'}
            </Button>
            {data.rows.length > 0 && (
              <Button variant="outline" size="sm" onClick={download}>
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
            )}
          </div>
        }
      />

      {/* ── where the figures come from, said before the table ── */}
      <p className="text-secondary-13 text-muted-foreground">
        Post went out {data.post_day ? shortDay(data.post_day) : '— not yet'}.
        {' '}Likers and commenters {readAt ? `read ${readAt}` : 'not read yet'}
        {data.people_status === 'failed' && data.people_error ? ` (last read failed: ${data.people_error})` : ''}.
        {' '}Follower list {data.followers_as_of ? `last read ${shortDay(data.followers_as_of)}` : 'not read yet'} — it is read once a day at 6 am.
        {' '}{data.inbox_noted ? 'The Inbox has been checked at least once.' : 'The Inbox has not been checked yet — press "Check the inbox now".'}
      </p>

      {data.state !== 'ready' ? (
        <Card><CardContent className="pt-6 text-[14px] text-muted-foreground">{stateLine(data.state)}</CardContent></Card>
      ) : (
        <>
          {/* ── counts, each a filter ── */}
          <div className="flex flex-wrap gap-2">
            <CountButton active={focus === 'all'} onClick={() => setFocus('all')} label="Everyone" n={data.counts.all} tone="ink" />
            {ORDER.map(v => (
              <CountButton key={v} active={focus === v} onClick={() => setFocus(v)} label={VERDICT_SHORT[v]} n={data.counts[v]} tone={TONE[v]} />
            ))}
          </div>

          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead className="text-left text-[12px] uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 font-semibold">Person</th>
                    <th className="px-4 py-3 font-semibold">On this post</th>
                    <th className="px-4 py-3 font-semibold">Following</th>
                    <th className="px-4 py-3 font-semibold">Reached out</th>
                    <th className="px-4 py-3 font-semibold">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      {data.rows.length === 0 ? 'Nobody read for this post yet.' : 'Nobody in this group.'}
                    </td></tr>
                  )}
                  {rows.map(r => (
                    <tr key={r.person.key} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          {r.person.profile_pic
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={r.person.profile_pic} alt="" className="h-8 w-8 rounded-full object-cover" referrerPolicy="no-referrer" />
                            : <span className="h-8 w-8 rounded-full bg-foreground/[0.08]" />}
                          <div className="min-w-0">
                            <a href={r.person.profile_href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold hover:underline">
                              @{r.person.username}
                              {r.person.is_verified && <BadgeCheck className="h-3.5 w-3.5 text-accent-blue-deep" />}
                              {r.person.is_private && <Lock className="h-3 w-3 text-muted-foreground" />}
                              <ExternalLink className="h-3 w-3 text-muted-foreground" />
                            </a>
                            {r.person.full_name && <p className="truncate text-muted-foreground">{r.person.full_name}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 capitalize">{r.did}</td>
                      <td className="px-4 py-3">
                        {r.verdict === 'not_following' ? 'No'
                          : r.verdict === 'left' ? `Left${r.person.gone_on ? ` ${shortDay(r.person.gone_on)}` : ''}`
                          : r.person.followed_on ? `Since ${shortDay(r.person.followed_on)}` : 'Before we started watching'}
                      </td>
                      <td className="px-4 py-3">
                        {r.person.reached_out_on
                          ? <Link href={r.person.inbox_href} className="hover:underline">{reachedOutWords(r.person)}</Link>
                          : <span className="text-muted-foreground">Not seen in the Inbox</span>}
                      </td>
                      <td className="px-4 py-3"><Chip tone={TONE[r.verdict]}>{VERDICT_WORDS[r.verdict]}</Chip></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* ── what each verdict means — the page never claims more than this ── */}
          <Card>
            <CardContent className="flex flex-col gap-1.5 pt-5 text-[13px] text-muted-foreground">
              <p className="font-semibold text-foreground">How each person is judged</p>
              {ORDER.map(v => (
                <p key={v}><span className="font-semibold text-foreground">{VERDICT_WORDS[v]}</span> — {VERDICT_MEANS[v]}.</p>
              ))}
              <p>&ldquo;Reached out&rdquo; only knows people seen when the Inbox was loaded — a blank cell means not seen there, never &ldquo;never wrote&rdquo;.</p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function CountButton({ active, onClick, label, n, tone }: {
  active: boolean; onClick: () => void; label: string; n: number; tone: ChipTone
}) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full border px-1 py-0.5 ${active ? 'border-foreground' : 'border-transparent'}`}>
      <Chip tone={tone}>{label} · {n}</Chip>
    </button>
  )
}

function stateLine(state: PostLeadsData['state']): string {
  switch (state) {
    case 'no_instagram_post': return 'This post has no Instagram copy — only Instagram says who liked a post.'
    case 'not_instagram': return 'This client has no active Instagram account connected.'
    case 'off': return 'The follower reader is switched off (HIKER_API_KEY).'
    case 'private': return 'The account is private, so its follower list cannot be read.'
    case 'waiting': return 'The follower list has not been read yet — the first read runs at 6 am.'
    default: return ''
  }
}
