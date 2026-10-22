'use client'

import { useEffect, useState } from 'react'
import { SmilePlus } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { REACTION_EMOJIS, reactionChips, toggleReaction, type ReactionEmoji } from '../../lib/comment-reactions-core'

/**
 * REACTIONS UNDER A COMMENT (the owner, 22 Oct 2026: "also in comments can u
 * please add reactions"). One chip per emoji somebody used — the count, lit
 * when it is mine, who reacted on hover — and a small button that opens the
 * seven to choose from. A press toggles mine; the row's live read brings
 * everybody else's. Drawn under every team comment: the card's thread
 * (CardSaid) and each clip's review page. Nobody is told about a reaction.
 */
export default function CommentReactions({ itemId, commentId, reactions, meId, nameOf, className }: {
  itemId: string
  commentId: string
  /** the row's `reactions`, as read live */
  reactions: unknown
  meId: string | null | undefined
  nameOf?: (uid: string) => string | null
  className?: string
}) {
  // mine shown at once; the live row takes over as soon as it changes
  const [local, setLocal] = useState<unknown>(null)
  const [pending, setPending] = useState(false)
  useEffect(() => { setLocal(null) }, [reactions])
  const shown = local ?? reactions
  const chips = reactionChips(shown, meId)

  const toggle = async (emoji: ReactionEmoji) => {
    if (!meId || pending) return
    setLocal(toggleReaction(shown, emoji, meId))
    setPending(true)
    try {
      const res = await fetch(`/api/production/items/${itemId}/comments/${commentId}/react`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emoji }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(json?.error ?? 'Could not react'))
      setLocal(json.reactions ?? null)
    } catch (e) {
      setLocal(null)
      toast.error(e instanceof Error ? e.message : 'Could not react')
    } finally {
      setPending(false)
    }
  }

  if (!meId && chips.length === 0) return null
  return (
    <div className={cn('mt-1.5 flex flex-wrap items-center gap-1', className)} data-comment-reactions>
      {chips.map(c => {
        const who = c.ids.map(id => (id === meId ? 'You' : nameOf?.(id) ?? 'Someone')).join(', ')
        return (
          <button key={c.emoji} type="button" disabled={!meId} onClick={() => void toggle(c.emoji)}
            title={who} aria-pressed={c.mine} aria-label={`${c.emoji} ${c.count} — ${who}`}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-full border px-2 text-[12px] leading-none',
              c.mine ? 'border-accent-blue bg-tint-blue font-semibold text-foreground' : 'border-border bg-muted text-muted-foreground hover:bg-muted/70',
            )}>
            <span aria-hidden>{c.emoji}</span>
            <span>{c.count}</span>
          </button>
        )
      })}
      {meId && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Add a reaction" title="Add a reaction"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground">
              <SmilePlus className="h-3.5 w-3.5" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="flex min-w-0 gap-0.5 bg-popover p-1">
            {REACTION_EMOJIS.map(e => (
              <DropdownMenuItem key={e} onSelect={() => void toggle(e)} aria-label={`React ${e}`}
                className={cn('min-h-0 h-9 w-9 justify-center rounded-full px-0 text-[17px]',
                  chips.some(c => c.emoji === e && c.mine) && 'bg-tint-blue')}>
                {e}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
