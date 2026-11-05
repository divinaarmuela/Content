import { platformLabel } from '../../../lib/client-report-core'
import { figureWords, hasValue, POST_EXTRAS, POST_STATS } from '../../../lib/report-v2/definitions'
import { filterPosts, type V2View } from '../../../lib/report-v2/filters'
import type { V2Post } from '../../../lib/report-v2/types'

/** REPORT V2 — the month's posts, filtered and sorted by the view in the URL. Presentation only (tested by rendering). */

const MIX_WORD: Record<string, string> = {
  follower: 'Followers', nonFollower: 'Non-followers', newViewer: 'New viewers', returnViewer: 'Returning viewers',
  forYou: 'For You', follow: 'Following', personalProfile: 'Profile', search: 'Search', sound: 'Sound', directMessage: 'Messages', other: 'Other',
}

export function PostDetail({ post }: { post: V2Post }) {
  const name = platformLabel(post.platform)
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      {post.caption && <p className="whitespace-pre-wrap">{post.caption}</p>}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        {POST_STATS.map(s => (
          <div key={s} className="contents"><dt className="capitalize text-muted-foreground">{s}</dt><dd className="tabular-nums">{figureWords(post.stats[s], name)}</dd></div>
        ))}
        {POST_EXTRAS.filter(x => post.extras[x.key] != null).map(x => (
          <div key={x.key} className="contents"><dt className="text-muted-foreground">{x.words}</dt><dd className="tabular-nums">{post.extras[x.key]!.toLocaleString('en-AU')}</dd></div>
        ))}
      </dl>
      {(['audienceTypes', 'impressionSources'] as const).map(k => post[k] && (
        <div key={k}>
          <div className="font-medium">{k === 'audienceTypes' ? 'Who watched' : 'Where the views came from'}</div>
          {Object.entries(post[k]!).sort((a, b) => b[1] - a[1]).map(([key, pct]) => <div key={key} className="flex justify-between"><span>{MIX_WORD[key] ?? key}</span><span>{pct}%</span></div>)}
        </div>
      ))}
      {post.url && <a className="text-accent-blue underline" href={post.url} target="_blank" rel="noreferrer">Open on {name}</a>}
    </div>
  )
}

export default function PostsGrid({ posts, view, onOpen }: { posts: readonly V2Post[]; view: Pick<V2View, 'account' | 'type' | 'by' | 'sort'>; onOpen?: (p: V2Post) => void }) {
  const shown = filterPosts(posts, view)
  if (!shown.length) return <p className="text-[14px] text-muted-foreground" data-testid="no-posts">No posts match these filters.</p>
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="posts">
      {shown.map(p => {
        const name = platformLabel(p.platform)
        const main = (['views', 'reach', 'likes'] as const).filter(s => p.stats[s].state === 'value')
        return (
          <li key={`${p.platform}-${p.id}`} data-post={p.id} className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3">
            <button type="button" onClick={() => onOpen?.(p)} className="flex flex-col gap-2 text-left">
              {p.thumbnail
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={p.thumbnail} alt="" className="aspect-square w-full rounded-md bg-muted object-cover" loading="lazy" />
                : <div className="flex aspect-square w-full items-center justify-center rounded-md bg-muted text-[12px] text-muted-foreground">No picture</div>}
              <span className="flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                <span>{name}</span><span>· {p.kind}</span><span>· {p.publishedAt ? p.publishedAt.slice(0, 10) : 'no date'}</span><span>· {p.byMdm ? 'MD Media' : 'not by MD Media'}</span>
              </span>
              <span className="line-clamp-2 text-[13px]">{p.caption || '(no caption)'}</span>
              <span className="flex flex-wrap gap-x-3 text-[13px] tabular-nums">
                {main.map(s => <span key={s}><strong>{p.stats[s].value!.toLocaleString('en-AU')}</strong> {s}</span>)}
                {!main.length && <span className="text-muted-foreground">{p.kind === 'story' ? 'Story — its numbers expire' : `${name} gave no numbers`}</span>}
                {p.platform === 'instagram' && (p.extras.follows ?? 0) > 0 && <span><strong>{p.extras.follows}</strong> followed from this post</span>}
                {hasValue(p.stats.saves) && p.stats.saves.value! > 0 && <span><strong>{p.stats.saves.value}</strong> saves</span>}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
