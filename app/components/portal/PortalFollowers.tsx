import type { PortalFollowers as Data, PortalFollower } from '../../lib/followers-core'
import { shortDay } from '../../lib/followers-core'
import { SectionHeading } from './PortalSections'

/**
 * The client's followers, on their portal — the count, who joined this week,
 * who left. Rendered only when the client's manager switched it on, in the
 * portal's own voice (the --p-* tokens). Purely presentational: no hooks, no
 * I/O, nothing to press. Names link nowhere — a client can find a follower
 * on Instagram themselves, and a link out of their own portal to a stranger's
 * profile is not something to hand them by accident.
 */

const surface: React.CSSProperties = {
  background: 'var(--p-surface, #ffffff)',
  border: '1px solid var(--p-border, #e4e4e7)',
}

export default function PortalFollowersView({ data }: { data: Data }) {
  return (
    <section className="flex flex-col gap-6" data-portal-section="followers">
      <SectionHeading>YOUR FOLLOWERS</SectionHeading>
      <p className="text-[14px]">
        {typeof data.count === 'number'
          ? <><strong className="font-semibold tabular-nums">{data.count.toLocaleString()}</strong> followers</>
          : 'Your followers'}
        {' · '}{data.new_this_week.length === 1 ? '1 joined' : `${data.new_this_week.length} joined`} this week
        {data.left_this_week.length > 0 && ` · ${data.left_this_week.length} left`}
        {data.as_of && <span className="opacity-60"> · as of {shortDay(data.as_of)}</span>}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Pile title="Joined this week" empty="Nobody new this week." rows={data.new_this_week} word="Followed on" />
        <Pile title="Left this week" empty="Nobody has left this week." rows={data.left_this_week} word="Left on" />
      </div>
      {data.from_posts.length > 0 && (
        <div className="rounded-xl p-5" style={surface}>
          <h3 className="mb-3 text-sm font-semibold" style={{ fontFamily: 'var(--p-heading-font, inherit)' }}>Followed from a post</h3>
          <ul className="flex flex-col gap-2">
            {data.from_posts.map(p => (
              <li key={p.title} className="text-[14px]">
                <span className="font-semibold tabular-nums">{p.count}</span> {p.count === 1 ? 'person' : 'people'} liked or commented on <em>{p.title}</em> after following
                <span className="block text-[12px] opacity-60">{p.names.join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function Pile({ title, empty, rows, word }: { title: string; empty: string; rows: PortalFollower[]; word: string }) {
  return (
    <div className="rounded-xl p-5" style={surface}>
      <h3 className="mb-3 text-sm font-semibold" style={{ fontFamily: 'var(--p-heading-font, inherit)' }}>{title}</h3>
      {rows.length === 0 ? (
        <p className="text-[13px] opacity-60">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map(p => (
            <li key={p.username} className="flex min-h-11 items-center gap-3">
              {p.profile_pic ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.profile_pic} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" loading="lazy" />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs opacity-60" style={surface}>
                  {p.username.slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{p.full_name || p.username}{p.is_verified ? ' ✓' : ''}</p>
                <p className="truncate font-mono text-[12px] opacity-60" style={{ fontFamily: 'var(--p-mono-font, monospace)' }}>
                  @{p.username} · {word} {shortDay(p.day)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
