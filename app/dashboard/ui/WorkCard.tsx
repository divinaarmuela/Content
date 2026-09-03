import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * One piece of work on a board: who it is for, what it is, an optional still
 * from the footage, the status chips and who is holding it.
 *
 * The whole card is the link — the target is the card, not a small "open"
 * control in the corner — and `tone` tints the whole card so the one that
 * needs attention is obvious before anything is read.
 */

export type WorkTone = 'amber' | 'blue' | 'green' | 'red' | 'paper'

const TONE: Record<WorkTone, string> = {
  amber: 'bg-tint-amber',
  blue: 'bg-tint-blue',
  green: 'bg-tint-green',
  red: 'bg-tint-red',
  paper: 'bg-paper',
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
  client, title, thumb, chips, people = [], tone, href, className,
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
}) {
  const shown = people.slice(0, 3)
  const extra = people.length - shown.length

  return (
    <Link
      href={href}
      className={cn(
        'flex flex-col gap-2.5 rounded-inner p-3.5 text-foreground transition-shadow hover:shadow-[0_2px_12px_rgba(11,11,11,0.08)]',
        tone ? TONE[tone] : 'border border-border bg-surface',
        className,
      )}
    >
      {thumb && (
        /* alt="" on purpose: the still is decoration for the title that sits
           directly under it, so naming it would read the card out twice.
           A plain <img> rather than next/image — these come from Drive and
           Zernio, hosts that are not in the next.config image allowlist. */
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt="" loading="lazy" className="h-[92px] w-full rounded-tile object-cover" />
      )}
      <span className="text-[12px] font-semibold uppercase tracking-[0.02em] text-muted-foreground">{client}</span>
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
    </Link>
  )
}
