import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * One piece of work on a board: who it is for, what it is, an optional still
 * from the footage, the status chips and who is holding it.
 *
 * The whole card is the link — the target is the card, not a small "open"
 * control in the corner — and `tone` tints the whole card so the one that
 * needs attention is obvious before anything is read.
 *
 * A card that carries its OWN buttons (claim it, assign it, open the comments)
 * passes `actions`. Then the link stops wrapping the card and stretches under
 * it instead, because a button inside an anchor is neither valid nor operable.
 */

export type WorkTone = 'amber' | 'blue' | 'green' | 'red' | 'paper' | 'ink'

const TONE: Record<WorkTone, string> = {
  amber: 'bg-tint-amber',
  blue: 'bg-tint-blue',
  green: 'bg-tint-green',
  red: 'bg-tint-red',
  paper: 'bg-paper',
  ink: 'bg-ink text-cream',
}

export type Person = { initials: string; name?: string; id?: string }

/**
 * Avatar colours are brand accent tokens, never loose hex, so they move with
 * the palette. Each pairs with the text colour that is actually readable on
 * it — cream on blue/red/ink, ink on green/amber.
 */
const AVATAR_COLORS = [
  'bg-accent-blue text-cream',
  'bg-ink text-cream',
  'bg-accent-red text-cream',
  'bg-accent-green text-ink',
  'bg-accent-amber text-ink',
]

/** stable per person, so the same face keeps the same colour across boards */
function avatarColor(p: Person) {
  const seed = p.id ?? p.name ?? p.initials
  let n = 0
  for (const ch of seed) n = (n * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[n % AVATAR_COLORS.length]
}

export default function WorkCard({
  client, title, thumb, chips, people = [], tone, href, className, actions,
}: {
  /** the client's name — shown small and upper case above the title */
  client: string
  title: string
  /** image URL for a still; omit and the card is text only */
  thumb?: string
  /** a row of <Chip>s: status, date, count */
  chips?: React.ReactNode
  /** who is holding it; three avatars are shown, the rest become "+N" */
  people?: Person[]
  /** tints the whole card — use it for the one state that needs attention */
  tone?: WorkTone
  href: string
  className?: string
  /**
   * the card's own controls, on their own row at the bottom. Given at all —
   * even empty — the card stops being an anchor and the link stretches under
   * the content instead, so the buttons are real buttons. An empty row hides
   * itself rather than leaving a gap.
   */
  actions?: React.ReactNode
}) {
  const shown = people.slice(0, 3)
  const extra = people.length - shown.length

  const face = cn(
    'flex flex-col gap-2.5 rounded-inner p-3.5 transition-shadow hover:shadow-[0_2px_12px_rgba(11,11,11,0.08)]',
    tone ? TONE[tone] : 'border border-border bg-surface',
    tone === 'ink' ? '' : 'text-foreground',
    className,
  )

  const body = (
    <>
      {thumb && (
        /* alt="" on purpose: the still is decoration for the title that sits
           directly under it, so naming it would read the card out twice.
           A plain <img> rather than next/image — these come from Drive and
           Zernio, hosts that are not in the next.config image allowlist. */
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt="" loading="lazy" className="h-[92px] w-full rounded-tile object-cover" />
      )}
      <span className={cn(
        'text-[12px] font-semibold uppercase tracking-[0.02em]',
        tone === 'ink' ? 'text-cream/60' : 'text-muted-foreground',
      )}>{client}</span>
      <span className="text-[15px] font-semibold leading-[1.25]">{title}</span>
      {(chips || people.length > 0) && (
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">{chips}</div>
          {people.length > 0 && (
            <div className="ml-auto flex shrink-0 gap-1">
              {shown.map((p, i) => (
                <span
                  key={`${p.initials}-${i}`}
                  title={p.name ?? p.initials}
                  className={cn('flex h-[26px] w-[26px] items-center justify-center rounded-full text-[11px] font-bold', avatarColor(p))}
                >
                  {p.initials}
                </span>
              ))}
              {extra > 0 && (
                <span className="flex h-[26px] items-center justify-center rounded-full bg-foreground/[0.08] px-1.5 text-[11px] font-bold">
                  +{extra}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )

  if (actions !== undefined) {
    return (
      <div className={cn('relative', face)}>
        {/* the whole card is still the target — the buttons simply sit on top */}
        <Link href={href} aria-label={title} className="absolute inset-0 rounded-inner" />
        {body}
        <div className="relative z-10 flex flex-wrap items-center gap-1.5 empty:hidden">{actions}</div>
      </div>
    )
  }

  return (
    <Link href={href} className={face}>
      {body}
    </Link>
  )
}
