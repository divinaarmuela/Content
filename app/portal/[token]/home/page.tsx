import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Toaster } from 'sonner'
import { archivo, sometype } from '../../../components/lama/fonts'
import PortalShell from '../../../components/portal/PortalShell'
import PortalLive from '../../../components/portal/PortalLive'
import EditingReview from '../../../components/portal/EditingReview'
import { PortalCardView } from '../../../components/portal/PortalBoard'
import { PortalHelpLine } from '../../../components/portal/PortalSections'
import OnePortalTabs from '../../../components/portal/OnePortalTabs'
import OnePortalWorkList from '../../../components/portal/OnePortalWorkList'
import OnePortalShoots from '../../../components/portal/OnePortalShoots'
import { loadOnePortal } from '../../../lib/one-portal-page'
import { loadScheduling, profilesForWork, schedulingWaiting, schedulingWorks } from '../../../lib/one-portal-schedule'
import OnePortalList, { type ListRow } from '../../../components/portal/OnePortalList'
import ShootBoard from '../../../components/portal/ShootBoard'
import { getPortalTeamBoardDetail } from '../../../lib/portal-team-board'
import { waitsOnClient } from '../../../lib/one-portal-page'
import OnePortalScheduling from '../../../components/portal/OnePortalScheduling'
import { getEditingPortal, editingPortalWaiting } from '../../../lib/editing-portal'
import { PORTAL_TABS, onePortalPath, readTab } from '../../../lib/one-portal-core'
import { loadPortalForms, portalFormById } from '../../../lib/one-portal-forms'
import { FORM_PARAM, formTab } from '../../../lib/one-portal-forms-core'
import { getIntakeByToken, listIntakeFiles } from '../../../lib/intake'
import { getMonthlyByToken } from '../../../lib/monthly'
import { monthLabel } from '../../../lib/monthly-core'
import { getShootByToken } from '../../../lib/shoots'
import IntakeForm from '../../../intake/[token]/IntakeForm'
import MonthlyForm from '../../../monthly/[token]/MonthlyForm'
import ShootAnswer from '../../../shoot/[token]/ShootAnswer'
import { PortalIntakeView } from '../../../components/portal/PortalIntake'

export const metadata: Metadata = {
  title: 'Your portal — MD Media',
  robots: 'noindex, nofollow',
}
export const dynamic = 'force-dynamic'

/**
 * THE ONE PORTAL (docs/ONE_PORTAL_SPEC.md; the owner, 2 Oct 2026: "we don't wanna keep sending them different
 * links"). One page per link — the business's or a person's — with four tabs: Shoot brief, Editing, Designing,
 * Scheduling. `?tab=` opens a tab and `&id=` one thing in it, so every email is this one address. Only for a
 * client on the one portal (clients.portal_one); anyone else's link answers 404 here and keeps today's portal.
 */
export default async function OnePortalPage({ params, searchParams }: {
  params: Promise<{ token: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const { token: raw } = await params
  const page = await loadOnePortal(raw)
  if (!page) notFound()
  const sp = (await searchParams) ?? {}
  const askedTab = typeof sp.tab === 'string' ? readTab(sp.tab) : null
  // the booked posts always (the tab's badge); the posted feeds only when the Scheduling tab is open
  const profiles = await loadScheduling(page.client.id, page.scope, page.data.client.timezone, new Date(), askedTab === 'scheduling' || askedTab === null)
  page.waiting.scheduling = schedulingWaiting(profiles)
  // THE FORMS (2 Oct 2026: "all this links should redirect to their one portal"): intake forms, monthly updates and
  // shoot-date proposals are rows on the Shoot brief tab; the business's only, never on a person's portal
  const forms = await loadPortalForms(page.client.id, page.scope, page.data.client.timezone || 'Australia/Melbourne')
  page.waiting.shoot += forms.filter(f => f.waiting && formTab(f.kind) === 'shoot').length
  page.waiting.forms += forms.filter(f => f.waiting && formTab(f.kind) === 'forms').length
  // no tab asked for: the first one with something waiting on them, else Scheduling (what goes out next)
  const tab = typeof sp.tab === 'string' ? readTab(sp.tab) : (PORTAL_TABS.find(t => page.waiting[t.key] > 0)?.key ?? 'scheduling')
  const id = typeof sp.id === 'string' ? sp.id : null
  const boardId = typeof sp.board === 'string' ? sp.board : null
  const { token, data } = page

  // ONE FORM, FULL SCREEN, AT A PORTAL ADDRESS — the same page its old link opened, with the way back to the portal.
  // Saving goes through the form's own routes as before; only where it is opened from changed.
  const pick = (k: keyof typeof FORM_PARAM) => (typeof sp[FORM_PARAM[k]] === 'string' ? String(sp[FORM_PARAM[k]]) : null)
  const fullScreen = tab === 'forms' ? (pick('intake') || pick('monthly')) : tab === 'shoot' ? pick('proposal') : null
  if (fullScreen) {
    if (page.scope.kind !== 'business') notFound()
    const backHref = onePortalPath(token, tab)
    const fonts = `${archivo.variable} ${sometype.variable}`
    if (tab === 'forms' && pick('intake')) {
      const row = await portalFormById<{ client_id: string }>('intake', pick('intake')!, page.client.id)
      const form = row ? await getIntakeByToken(row.token) : null
      if (!form || form.status === 'draft') notFound()
      return (
        <div className={fonts}>
          <IntakeForm token={form.token} clientName={data.client.name} title={form.title || 'Intake'} definition={form.definition}
            initialAnswers={form.answers} initialStatus={form.status} files={await listIntakeFiles(form.id)} backHref={backHref} />
        </div>
      )
    }
    if (tab === 'forms' && pick('monthly')) {
      const row = await portalFormById<{ client_id: string }>('monthly', pick('monthly')!, page.client.id)
      const form = row ? await getMonthlyByToken(row.token) : null
      if (!form || form.status === 'draft') notFound()
      const period = monthLabel(form.month, form.year)
      return (
        <div className={fonts}>
          <MonthlyForm token={form.token} clientName={data.client.name} title={form.title || `Monthly update — ${period}`} period={period}
            definition={form.definition} initialAnswers={form.answers} initialStatus={form.status} backHref={backHref} />
        </div>
      )
    }
    const row = await portalFormById<{ client_id: string }>('proposal', pick('proposal')!, page.client.id)
    const proposal = row ? await getShootByToken(row.token) : null
    if (!proposal) notFound()
    return (
      <div className={fonts}>
        <ShootAnswer token={proposal.token} clientName={data.client.name} title={proposal.title} startsAt={proposal.starts_at}
          endsAt={proposal.ends_at} location={proposal.location} note={proposal.note} initialStatus={proposal.status} backHref={backHref} />
      </div>
    )
  }
  const tabLabel = PORTAL_TABS.find(t => t.key === tab)!.label
  const back = (words: string) => (
    <Link href={onePortalPath(token, tab)} className="inline-flex min-h-10 w-fit items-center text-[13px] font-semibold underline-offset-4 hover:underline">← {words}</Link>
  )
  const title = (words: string, line?: string | null) => (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
      <h1 className="text-[26px] font-semibold leading-tight tracking-tight sm:text-[34px]">{words}</h1>
      {line && <p className="pb-1 text-[13px] text-muted-foreground">{line}</p>}
    </div>
  )

  // one piece opened inside Editing / Designing: today's review, on this page
  let opened: React.ReactNode = null
  if (id && (tab === 'editing' || tab === 'designing')) {
    const card = (tab === 'editing' ? page.editing : page.designing).find(c => c.id === id) ?? null
    if (!card) notFound()
    const review = card.editing ? await getEditingPortal(token, id) : null
    const waiting = !review && card.editing ? await editingPortalWaiting(token, id) : null
    opened = (
      <div className="flex flex-col gap-5" data-one-portal-open={id}>
        <Link href={onePortalPath(token, tab)} className="inline-flex min-h-10 w-fit items-center text-[13px] font-semibold underline-offset-4 hover:underline">
          ← All {tab === 'editing' ? 'edits' : 'designs'}
        </Link>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight sm:text-[34px]">{card.title}</h1>
          {review && <p className="pb-1 text-[13px] text-muted-foreground">{card.column === 'approved' ? 'Approved' : review.item.status_label}</p>}
        </div>
        {review ? <EditingReview data={review} approved={card.column === 'approved'} />
          : waiting ? <p className="max-w-md text-[15px] text-muted-foreground">Your edit is on its way — the files are still arriving. Refresh in a minute.</p>
          : <PortalCardView card={card} amName={data.am_name} surface={{ token }} className="max-w-3xl" />}
      </div>
    )
  }

  // SHOOT BRIEF — one shoot, or one board, on its own page (the owner, 2 Oct 2026: "mini pages… October shoot")
  if (tab === 'shoot' && id) {
    const card = page.shoots.find(c => c.id === id) ?? null
    if (!card) notFound()
    opened = (
      <div className="flex flex-col gap-5" data-one-portal-open={id}>
        {back('All shoots')}
        <OnePortalShoots token={token} data={data} shoots={[card]} initialCardId={typeof sp.card === 'string' ? sp.card : null} />
      </div>
    )
  }
  const answersId = tab === 'forms' && page.scope.kind === 'business' ? pick('answers') : null
  if (answersId) {
    const form = (data.intake ?? []).find(f => f.id === answersId) ?? null
    if (!form) notFound()
    opened = (
      <div className="flex flex-col gap-5" data-one-portal-open={answersId}>
        {back('All forms')}
        <PortalIntakeView forms={[form]} />
      </div>
    )
  }
  // BOARDS — its own tab; an old `tab=shoot&board=` link still lands on the board
  const openBoard = tab === 'boards' ? id : tab === 'shoot' ? boardId : null
  if (openBoard) {
    if (!page.boards.some(b => b.id === openBoard)) notFound()
    const board = await getPortalTeamBoardDetail(token, openBoard)
    if (!board) notFound()
    opened = (
      <div className="flex flex-col gap-5" data-one-portal-board={openBoard}>
        <Link href={onePortalPath(token, 'boards')} className="inline-flex min-h-10 w-fit items-center text-[13px] font-semibold underline-offset-4 hover:underline">← All boards</Link>
        {title(board.board.name, 'Board')}
        {board.board.canvas_cards.length > 0 ? (
          <ShootBoard shootId={board.board.id} thread="team_board" boardName={board.board.name} cards={board.board.canvas_cards}
            comments={board.comments} surface={{ token }} clientName={board.client.name} amName={board.am_name}
            initialCardId={typeof sp.card === 'string' ? sp.card : null} />
        ) : (
          <p className="rounded-card border border-border bg-card p-6 text-[15px] text-muted-foreground">Nothing on the board yet — {board.am_name ?? 'your account manager'} will add to it.</p>
        )}
      </div>
    )
  }

  // SCHEDULING — "by the work" (the owner, 2 Oct 2026): one page per piece the posts came from, plus Your feed.
  // `post=` opens one post on top wherever it is (the email links); an old `id=<post>` link still lands on it.
  const allTiles = profiles.flatMap(p => [...p.booked, ...p.off])
  const askedPost = typeof sp.post === 'string' ? sp.post : (id && allTiles.some(t => t.post_id === id) ? id : null)
  const works = schedulingWorks(profiles)
  if (tab === 'scheduling' && (id || askedPost)) {
    const postWork = askedPost ? allTiles.find(t => t.post_id === askedPost)?.work_id ?? null : null
    const workId = id && id !== askedPost ? id : postWork ?? 'feed'
    const work = works.find(w => w.id === workId) ?? null
    if (workId !== 'feed' && !work) notFound()
    opened = (
      <div className="flex flex-col gap-5" data-one-portal-work-page={workId}>
        {back('All posts')}
        {title(workId === 'feed' ? 'Your feed' : work!.title, workId === 'feed' ? 'Everything booked, and what is already posted' : `${work!.booked} booked${work!.off ? ` · ${work!.off} off the schedule` : ''}`)}
        <OnePortalScheduling token={token} profiles={workId === 'feed' ? profiles : profilesForWork(profiles, workId)} openPostId={askedPost} />
      </div>
    )
  }

  // the tab's own list pages
  const shootRows: ListRow[] = page.shoots.map(c => ({
    key: c.id,
    href: `${onePortalPath(token, 'shoot', c.id)}`,
    title: c.title,
    line: [c.shoot?.date_label ?? null, c.line].filter(Boolean).join(' · ') || null,
    chip: waitsOnClient(c) ? { words: 'Waiting on you', tone: 'waiting' } : c.column === 'approved' ? { words: 'Approved', tone: 'done' } : null,
  }))
  const openForms = new Set(forms.filter(f => f.kind === 'intake').map(f => f.id))
  const formListRows: ListRow[] = [
    ...forms.map(f => ({
      key: `${f.kind}-${f.id}`,
      href: `${onePortalPath(token, formTab(f.kind))}&${FORM_PARAM[f.kind]}=${encodeURIComponent(f.id)}`,
      title: f.title,
      line: f.line,
      chip: f.waiting ? { words: f.kind === 'proposal' ? 'Waiting on you' : 'To fill in', tone: 'waiting' as const } : f.done ? { words: 'Booked', tone: 'done' as const } : null,
    })),
    // answers the team shows on the portal, once the form is no longer theirs to fill in
    ...(page.scope.kind === 'business' ? (data.intake ?? []) : []).filter(f => !openForms.has(f.id)).map(f => ({
      key: `answers-${f.id}`,
      href: `${onePortalPath(token, 'forms')}&${FORM_PARAM.answers}=${encodeURIComponent(f.id)}`,
      title: f.title,
      line: `Your answers · ${f.answered} of ${f.total} answered`,
      chip: null,
    })),
  ]
  const dateRows = formListRows.filter(r => r.key.startsWith('proposal-'))
  const formsTabRows = formListRows.filter(r => !r.key.startsWith('proposal-'))
  const boardRows: ListRow[] = page.boards.map(b => ({
    key: b.id, href: onePortalPath(token, 'boards', b.id), title: b.name, line: 'A board from the team',
  }))
  const workRows: ListRow[] = works.map(w => ({
    key: w.id,
    href: onePortalPath(token, 'scheduling', w.id),
    title: w.title,
    line: `${w.booked} booked${w.off ? ` · ${w.off} off the schedule` : ''}`,
    chip: w.waiting > 0 ? { words: `${w.waiting} to look at`, tone: 'waiting' } : w.booked > 0 ? { words: 'All answered', tone: 'done' } : null,
  }))

  return (
    <PortalShell className={`dbx ${archivo.variable} ${sometype.variable}`}>
      <PortalLive clientId={data.client.id} />
      <div
        className="min-h-screen bg-background text-foreground"
        style={{
          fontFamily: 'var(--font-archivo), Helvetica, Arial, sans-serif',
          ['--p-bg' as string]: 'hsl(var(--background))',
          ['--p-ink' as string]: 'hsl(var(--foreground))',
          ['--p-surface' as string]: 'hsl(var(--card))',
          ['--p-border' as string]: 'hsl(var(--border))',
          ['--p-accent' as string]: 'hsl(var(--primary))',
          ['--p-accent-ink' as string]: 'hsl(var(--primary-foreground))',
          ['--p-heading-font' as string]: 'var(--font-archivo), sans-serif',
          ['--p-mono-font' as string]: 'var(--font-sometype), monospace',
        }}
      >
        <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
          <div className="flex flex-col gap-1 px-5 pt-3 pr-14 sm:px-10 sm:pr-10">
            {/* min-h-11: as tall as PortalShell's fixed light/dark pill, so on a phone the tabs start below it */}
            <div className="flex min-h-11 items-center gap-3">
              <div className="flex shrink-0 items-center rounded-md bg-gradient-to-b from-zinc-800 to-zinc-950 px-2 py-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/MDLogo-trim.png" alt="MD Media" className="h-2.5 w-auto" />
              </div>
              <p className="truncate text-sm font-medium uppercase tracking-tight">{data.client.name}</p>
              <p className="ml-auto hidden shrink-0 text-[9px] uppercase tracking-[0.2em] opacity-40 sm:block" style={{ fontFamily: 'var(--font-sometype), monospace' }}>
                Your portal · by MD Media
              </p>
            </div>
            <OnePortalTabs token={token} active={tab} waiting={page.waiting} />
          </div>
        </header>

        <main className="portal-legible flex w-full flex-col gap-6 px-5 py-8 sm:px-10 sm:py-10" data-one-portal-tab={tab}>
          {opened ?? (
            <>
              <h1 className="text-[26px] font-semibold leading-tight tracking-tight sm:text-[34px]">{tabLabel}</h1>
              {tab === 'shoot' && dateRows.length > 0 && <OnePortalList heading="Shoot dates" rows={dateRows} />}
              {tab === 'forms' && <OnePortalList rows={formsTabRows} empty="No forms for you yet. When the team sends you one, it shows here." />}
              {tab === 'shoot' && (
                <OnePortalList heading={dateRows.length > 0 ? 'Shoots' : undefined} rows={shootRows} empty="No shoot plans to look at yet. When your next shoot is planned, it shows here." />
              )}
              {tab === 'boards' && <OnePortalList rows={boardRows} empty="No boards shared with you yet. When the team shares one, it shows here." />}
              {tab === 'editing' && <OnePortalWorkList token={token} tab="editing" cards={page.editing} empty="No edits to look at yet. When a video is ready for you, it shows here." />}
              {tab === 'designing' && <OnePortalWorkList token={token} tab="designing" cards={page.designing} empty="No designs to look at yet. When a design is ready for you, it shows here." />}
              {tab === 'scheduling' && (
                <div className="flex flex-col gap-6">
                  <OnePortalList rows={[{ key: 'feed', href: onePortalPath(token, 'scheduling', 'feed'), title: 'Your feed', line: 'Everything booked, and what is already posted — as each network shows it' }]} />
                  <OnePortalList heading="By the work" rows={workRows} empty="Nothing is booked yet. When a post is booked, it shows here." />
                </div>
              )}
            </>
          )}
        </main>

        <footer className="px-5 pb-24 sm:px-10 sm:pb-10">
          <PortalHelpLine amName={data.am_name} className="mb-3 text-muted-foreground opacity-100" />
          <p className="text-[12px] uppercase tracking-[0.14em] text-muted-foreground" style={{ fontFamily: 'var(--font-sometype), monospace' }}>
            MD Media · get seen · get known · get booked
          </p>
        </footer>
        <Toaster position="top-center" />
      </div>
    </PortalShell>
  )
}
