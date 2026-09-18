'use client'

import { cardLines, type BoardViewCard, type BoardViewer } from '../../lib/board-view-core'
import { finalFilesOf, hasFinishedWork } from '../../lib/final-files-core'
import { finishedEditOf } from '../../lib/card-link-core'

/**
 * THE BOARD AS A LIST (the owner, 16 Sep 2026: "is there a way to make a
 * list format?"). The same cards the columns hold, one row each, in the
 * columns' order: client, card, stage, who has it, version, whether a
 * finished edit is handed in, when it is due, and the account manager. A
 * press on a row opens the card, exactly as a press on its tile does. The
 * words come from `cardLines`, so a row never says something the tile
 * would not.
 */
export type ListGroup<T extends BoardViewCard> = { label: string; cards: readonly T[] }

export function BoardList<T extends BoardViewCard>({ groups, viewer, names, managersOf, today, onOpen, ariaLabel }: {
  groups: readonly ListGroup<T>[]
  viewer: BoardViewer
  names: Map<string, string>
  managersOf?: (clientId: string) => string[]
  today: string
  onOpen: (card: T) => void
  ariaLabel: string
}) {
  const rows = groups.flatMap(g => g.cards.map(card => ({ card, lane: g.label, lines: cardLines(card, { names, today, viewerId: viewer.id }) })))
  const th = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'
  const td = 'px-3 py-2.5 text-[13px] align-top'
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-card" data-board-list>
      <table className="w-full min-w-[900px] border-collapse" aria-label={ariaLabel}>
        <thead className="border-b border-border">
          <tr>
            <th scope="col" className={th}>Client</th>
            <th scope="col" className={th}>Card</th>
            <th scope="col" className={th}>Column</th>
            <th scope="col" className={th}>Stage</th>
            <th scope="col" className={th}>Who has it</th>
            <th scope="col" className={th}>Version</th>
            <th scope="col" className={th}>Files</th>
            <th scope="col" className={th}>Due</th>
            <th scope="col" className={th}>Account manager</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={9} className={`${td} text-muted-foreground`}>No cards here.</td></tr>
          )}
          {rows.map(({ card, lane, lines }) => {
            // a link, or files handed in on the card (the Designer page and the handover card, 17 Sep 2026)
            const handedIn = hasFinishedWork(card as never)
            const managers = managersOf?.(card.client_id) ?? []
            return (
              <tr key={card.id} tabIndex={0} role="button" aria-label={`Open ${lines.title}`}
                onClick={() => onOpen(card)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(card) } }}
                className="cursor-pointer border-b border-border last:border-b-0 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none">
                <td className={`${td} whitespace-nowrap text-muted-foreground`}>{lines.client}</td>
                <td className={`${td} min-w-[220px] font-semibold`}>{lines.title}{lines.kind ? <span className="block text-[12px] font-normal text-muted-foreground">{lines.kind}</span> : null}</td>
                <td className={`${td} whitespace-nowrap`}>{lane}</td>
                <td className={`${td} whitespace-nowrap`}>{lines.stage}{lines.asked ? <span className="block text-[12px] text-muted-foreground">{lines.asked}</span> : null}</td>
                <td className={`${td} whitespace-nowrap`}>{lines.assignee}</td>
                <td className={`${td} whitespace-nowrap`}>{lines.version}</td>
                <td className={`${td} whitespace-nowrap`}>{handedIn ? (finalFilesOf(card as never).length > 0 && !finishedEditOf(card as never) ? `${finalFilesOf(card as never).length} ${finalFilesOf(card as never).length === 1 ? 'file' : 'files'} on the card` : 'Finished edit in') : lines.link ? 'Folder only' : 'Nothing yet'}</td>
                <td className={`${td} whitespace-nowrap ${lines.dueNow ? 'font-semibold text-accent-red-deep' : ''}`}>{lines.due ?? '—'}</td>
                <td className={`${td} whitespace-nowrap text-muted-foreground`}>{managers.length > 0 ? managers.join(', ') : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
