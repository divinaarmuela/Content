'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { avatarFor, type FaceSubject } from '@/app/lib/social-access-core'
import PlatformIcon, { brandFor } from './PlatformIcon'

/**
 * AN ACCOUNT'S FACE — its real photo, or its initials on the network's colour.
 *
 * One component for every page that shows a channel, because the fallback is
 * the whole point and a second implementation of it will be the one that
 * forgets. Three things have to be true at once:
 *
 *  1. THE PHOTO IS OPTIONAL. `GET /v1/accounts` carries `profilePicture` for
 *     TikTok and YouTube and `null` for Instagram and LinkedIn — checked live
 *     on 5 Sep 2026. A missing photo is the ordinary case, not a fault, so
 *     initials are a first-class answer and never a grey box.
 *  2. THE PHOTO EXPIRES. TikTok's CDN signs its links with a deadline in the
 *     query string. `avatarFor` reads that deadline before the URL is used,
 *     and `onError` catches everything it cannot know about — a deleted
 *     photo, a signature spelled a way we have not seen, a CDN having a bad
 *     morning. Either way the row falls back to initials instead of showing a
 *     torn-image glyph next to an account whose health we are asserting.
 *  3. NOTHING IS TOLD WHO IS LOOKING. `referrerPolicy="no-referrer"` — a
 *     dashboard URL carrying a client id has no business in a CDN's logs, and
 *     several of these CDNs refuse a request with a referrer anyway.
 *
 * A plain `<img>` rather than `next/image`: these are third-party hosts that
 * would each need adding to `remotePatterns`, the URLs are signed and short
 * lived so the optimiser's cache is worth nothing, and a 44px circle is not
 * where image weight is decided.
 */
export default function AccountAvatar({
  account, size = 44, fallbackName = '', badge = true, className,
}: {
  account: FaceSubject | null | undefined
  /** the circle, in pixels. The badge scales with it. */
  size?: number
  /** what to call the account when it has neither handle nor name */
  fallbackName?: string
  /** the little network mark in the corner */
  badge?: boolean
  className?: string
}) {
  const platform = account?.platform ?? ''
  const face = avatarFor(account, Date.now(), fallbackName)
  const photoUrl = face.kind === 'photo' ? face.url : null

  /** the photo we gave up on. Keyed by URL so a refreshed one gets its own
   *  chance rather than inheriting the dead one's verdict. */
  const [broken, setBroken] = useState<string | null>(null)
  useEffect(() => { setBroken(null) }, [photoUrl])

  const showPhoto = photoUrl !== null && broken !== photoUrl
  const box = { width: size, height: size }

  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center rounded-full', className)}
      style={box}
    >
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(photoUrl)}
          style={box}
          className="rounded-full bg-muted object-cover"
        />
      ) : (
        <span
          aria-hidden
          style={{ ...box, background: brandFor(platform).background, fontSize: Math.max(10, Math.round(size * 0.28)) }}
          className="flex items-center justify-center rounded-full font-bold text-white"
        >
          {face.initials}
        </span>
      )}
      {badge && (
        <span className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-surface">
          <PlatformIcon platform={platform} size={Math.max(12, Math.round(size * 0.36))} />
        </span>
      )}
    </span>
  )
}
