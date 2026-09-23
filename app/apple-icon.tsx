import { ImageResponse } from 'next/og'
import { CREAM, INK, iconLayout } from './lib/app-icon-core'

/**
 * THE ICON iOS USES (the owner, 23 Sep 2026: "an icon on the phone like an
 * app"). iOS ignores the web manifest for the home-screen picture and reads
 * this apple-touch-icon instead, which Next links from every page by having
 * this file. Square and full-bleed: iOS rounds the corners itself, so a
 * rounded picture would be rounded twice.
 */
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  const l = iconLayout(size.width, false)
  return new ImageResponse(
    (
      <div style={{ width: l.size, height: l.size, display: 'flex', alignItems: 'center', justifyContent: 'center', background: INK }}>
        <div style={{ display: 'flex', alignItems: 'center', color: CREAM, fontSize: l.fontSize, letterSpacing: -l.fontSize * 0.03 }}>
          MD
        </div>
      </div>
    ),
    size,
  )
}
