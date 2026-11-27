import { ImageResponse } from 'next/og'
import { BLUE, CREAM, INK } from './lib/app-icon-core'

/**
 * THE PICTURE A LINK SHOWS WHEN IT IS PASTED INTO A CHAT (the owner, 27 Nov 2026, of a portal link in Slack: "why are
 * portal share links broken thumbnail"). No page on the site named a preview picture — the served head had no
 * `og:image` at all (checked by fetching a portal link as Slack does) — so Slack drew its empty grey box beside
 * the title. Next links this file from every page that has none of its own, the portal included.
 *
 * Drawn, not stored, like the app icons (app-icon-core): the agency's name on its own ink, nothing about any client,
 * because the same picture stands for a portal link, the dashboard and the public site.
 */
export const alt = 'MD Media'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: INK, color: CREAM, padding: 80 }}>
        <div style={{ display: 'flex', alignItems: 'center', fontSize: 150, letterSpacing: -5, lineHeight: 1 }}>
          <span>MD</span>
          <span style={{ color: BLUE, margin: '0 6px' }}>/</span>
          <span>MEDIA</span>
        </div>
        <div style={{ display: 'flex', fontSize: 40, letterSpacing: 6, opacity: 0.75 }}>
          GET SEEN · GET KNOWN · GET BOOKED
        </div>
      </div>
    ),
    size,
  )
}
