import { archivo, sometype } from '../../components/lama/fonts'
import type { SharedComment, SharedShoot } from '../../lib/shoot-share-core'
import type { ReferenceMedia } from '../../lib/batch-brief-core'
import SharedBoard from './SharedBoard'

/**
 * WHAT THE TEAM LINK DRAWS (shoot-share-core). Its own file so the page is only the lookup, and so the look can be
 * checked without a live link. Divs, never a section element: this is outside the dashboard, where globals.css still pads and
 * rules every section; a border says `border-solid` because nothing here resets it.
 */
const when = (iso: string | null) => (iso
  ? new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  : '')

const H = 'text-[12px] font-semibold uppercase tracking-widest text-muted-foreground'

function Comment({ c, on }: { c: SharedComment; on?: string }) {
  return (
    <div className={`flex flex-col gap-1.5 rounded-[10px] border border-solid border-border p-3 text-[14px] ${c.resolved ? 'bg-muted/40' : 'bg-card'}`} data-shared-comment>
      {c.quote && <p className="w-fit rounded-[4px] bg-tint-amber px-1.5 py-0.5 text-[13px] italic">“{c.quote}”</p>}
      {!c.quote && on && <p className="text-[12px] text-muted-foreground">On {on}</p>}
      <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
        <span className="font-semibold">{c.who}</span>
        {c.fromClient && <span className="rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider bg-tint-blue">Client</span>}
        <span className="text-muted-foreground">{when(c.at)}</span>
        {c.resolved && <span className="text-[12px] text-muted-foreground">· resolved</span>}
      </p>
      <p className="whitespace-pre-wrap break-words">{c.body}</p>
      {c.replies.map(r => (
        <div key={r.id} className="ml-3 flex flex-col gap-0.5 border-0 border-l-2 border-solid border-border pl-3">
          <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
            <span className="font-semibold">{r.who}</span>
            {r.fromClient && <span className="rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider bg-tint-blue">Client</span>}
            <span className="text-muted-foreground">{when(r.at)}</span>
          </p>
          <p className="whitespace-pre-wrap break-words">{r.body}</p>
        </div>
      ))}
    </div>
  )
}

export default function SharedShootView({ shoot }: { shoot: (SharedShoot & { references: unknown[] }) | null }) {
  return (
    <div className={`dbx ${archivo.variable} ${sometype.variable}`}>
      <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: 'var(--font-archivo), Helvetica, Arial, sans-serif' }}>
        <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10" data-shoot-plan>
          {!shoot ? (
            <div className="flex flex-col gap-2 py-16 text-center">
              <h1 className="text-[26px] font-semibold leading-tight">This link has been switched off</h1>
              <p className="text-[15px] text-muted-foreground">Ask whoever sent it to you for a new one.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <p className={H}>MD Media · shoot plan</p>
                <h1 className="text-[28px] font-semibold leading-tight sm:text-[34px]">{shoot.title}</h1>
                {shoot.client && <p className="text-[15px] text-muted-foreground">{shoot.client}</p>}
                <p className="text-[13px] text-muted-foreground">For the team working on this shoot. Read only: nothing here can be changed. Please do not forward it to the client.</p>
              </div>

              <div className="flex flex-col gap-4 rounded-[16px] border border-solid border-border bg-card p-4 sm:p-5">
                <p className={H}>The shoot plan</p>
                <dl className="grid gap-4 sm:grid-cols-2">
                  {shoot.parts.map(p => (
                    <div key={p.label} className="flex min-w-0 flex-col gap-0.5">
                      <dt className="text-[12px] font-semibold">{p.label}</dt>
                      <dd className="whitespace-pre-wrap break-words text-[15px]">{p.value}</dd>
                    </div>
                  ))}
                </dl>
                {shoot.notes && (
                  <div className="flex flex-col gap-0.5 border-0 border-t border-solid border-border pt-3">
                    <p className="text-[12px] font-semibold">Notes for the team</p>
                    <p className="whitespace-pre-wrap break-words text-[15px]">{shoot.notes}</p>
                  </div>
                )}
                {shoot.onThePlan.length > 0 && (
                  <div className="flex flex-col gap-2 border-0 border-t border-solid border-border pt-3">
                    <p className="text-[12px] font-semibold">Comments on the plan</p>
                    {shoot.onThePlan.map(c => <Comment key={c.id} c={c} on={c.on} />)}
                  </div>
                )}
              </div>

              {shoot.scripts.length > 0 && (
                <div className="flex flex-col gap-3">
                  <p className={H}>Scripts · {shoot.scripts.length}</p>
                  {shoot.scripts.map(s => (
                    <div key={s.key} className="flex flex-col gap-3 rounded-[16px] border border-solid border-border bg-card p-4 sm:p-5" data-shared-script>
                      <h2 className="text-[18px] font-semibold leading-snug">{s.heading}</h2>
                      <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{s.lines.join('\n')}</p>
                      {s.comments.length > 0 && (
                        <div className="flex flex-col gap-2 border-0 border-t border-solid border-border pt-3">
                          <p className="text-[12px] font-semibold">{s.comments.length === 1 ? '1 comment on this script' : `${s.comments.length} comments on this script`}</p>
                          {s.comments.map(c => <Comment key={c.id} c={c} />)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {shoot.cards.length > 0 && (
                <div className="flex flex-col gap-3">
                  <p className={H}>The board</p>
                  <SharedBoard cards={shoot.cards} references={shoot.references as ReferenceMedia[]} clientName={shoot.client ?? undefined} />
                  {shoot.onTheBoard.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <p className="text-[12px] font-semibold">Comments on the board</p>
                      {shoot.onTheBoard.map(c => <Comment key={c.id} c={c} on={c.on} />)}
                    </div>
                  )}
                </div>
              )}

              {shoot.general.length > 0 && (
                <div className="flex flex-col gap-3">
                  <p className={H}>Comments · {shoot.general.length}</p>
                  {shoot.general.map(c => <Comment key={c.id} c={c} />)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
