'use client'

import type { SocialAccount } from '@/lib/db-types'
import type { ChannelExtras } from '@/app/lib/schedule-compose-core'
import { networkName, PLATFORM_RULES, isPlatform } from '@/app/lib/publish-core'
import PlatformIcon from '../PlatformIcon'

/**
 * A CHANNEL'S OWN WORDS (the owner, 19 Oct 2026: "i have tiktok, linkedin and
 * facebook but im unable to publish different captions for each platform").
 *
 * Under the shared caption, one line per network the post goes to: "Same
 * caption" until somebody presses "Write different words", which opens a box
 * starting from the shared caption. What is typed is the channel's
 * `per_channel[id].caption` — Zernio's `customContent` on that platform entry
 * (publish-core) — and the previews, the quality check and the client's
 * portal all read the same field, so what is approved is what goes out.
 *
 * Read only (a post past its draft), it shows only the channels that have
 * words of their own.
 */
export default function ChannelCaptions({
  channels, perChannel, caption, editable, onChange, noCaption,
}: {
  channels: readonly SocialAccount[]
  perChannel: Record<string, ChannelExtras>
  /** the shared caption — what a channel without its own words posts */
  caption: string
  editable: boolean
  /** `undefined` puts the channel back on the shared caption */
  onChange: (channelId: string, words: string | undefined) => void
  /** a channel posting a Story has no caption at all */
  noCaption: (account: SocialAccount) => boolean
}) {
  const rows = channels.filter(a => !noCaption(a))
  const own = (a: SocialAccount) => perChannel[a.id]?.caption
  // one network on the post: the main caption already IS its caption
  if (rows.length < 2 && !rows.some(a => own(a) !== undefined)) return null
  const shownRows = editable ? rows : rows.filter(a => own(a)?.trim())
  if (shownRows.length === 0) return null

  return (
    <div className="flex flex-col gap-2" data-channel-captions>
      <span className="text-[12px] font-semibold text-muted-foreground">
        {editable ? 'Words for each network' : 'Different words on'}
      </span>
      {shownRows.map(a => {
        const p = String(a.platform)
        const name = networkName(p)
        const words = own(a)
        const max = isPlatform(p) ? PLATFORM_RULES[p]?.captionMax : undefined
        const length = (words ?? caption).trim().length
        return (
          <div key={a.id} className="flex flex-col gap-1.5 rounded-inner border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <PlatformIcon platform={p} size={16} className="rounded-full" />
              <span className="text-[13px] font-semibold">{name}</span>
              {a.username && <span className="truncate text-[12px] text-muted-foreground">{a.username}</span>}
              {editable && (
                words === undefined ? (
                  <button type="button" onClick={() => onChange(a.id, caption)}
                    className="ml-auto min-h-9 rounded-full border border-border px-3 text-[12px] font-semibold hover:bg-muted">
                    Write different words
                  </button>
                ) : (
                  <button type="button" onClick={() => onChange(a.id, undefined)}
                    className="ml-auto min-h-9 rounded-full border border-border px-3 text-[12px] font-semibold hover:bg-muted">
                    Use the main caption
                  </button>
                )
              )}
            </div>
            {words === undefined ? (
              <p className="text-[12px] text-muted-foreground">Same caption as above.</p>
            ) : (
              <textarea
                value={words}
                onChange={e => onChange(a.id, e.target.value)}
                readOnly={!editable}
                rows={4}
                aria-label={`Caption for ${name}`}
                placeholder={editable ? `What goes out on ${name}?` : ''}
                data-channel-caption={p}
                className="w-full resize-y bg-transparent text-[14px] leading-[1.45] text-foreground outline-none placeholder:text-muted-foreground"
              />
            )}
            {editable && max !== undefined && length > max && (
              <p className="text-[12px] font-medium text-accent-red-deep">
                Too long for {name}: {length} of {max} letters.
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
