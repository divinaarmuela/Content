import { ImageResponse } from 'next/og'
import { BLUE, CREAM, INK, ICON_PARAMS, iconLayout, parseIconParam } from '../../lib/app-icon-core'

/**
 * THE HOME-SCREEN ICON, DRAWN (the owner, 23 Sep 2026: "how do i make this
 * into an icon on the phone like an app"). One route answers every size the
 * manifest and iOS ask for, so there is no binary logo in the repo to fall out
 * of step with the brand.
 *
 * `/icons/192-maskable` is the Android copy: launchers crop an icon to their
 * own shape, so the mark sits inside the circle they keep and the square is
 * full-bleed. The shape is a path segment, not a query — see the note on
 * ICON_PARAMS for what that cost the first time.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-static'

export function generateStaticParams() {
  return ICON_PARAMS.map(size => ({ size }))
}

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const asked = parseIconParam((await params).size)
  if (!asked) return new Response('No such icon', { status: 404 })
  const l = iconLayout(asked.size, asked.maskable)

  return new ImageResponse(
    (
      <div
        style={{
          width: l.size, height: l.size, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: INK, borderRadius: l.radius,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', color: CREAM, fontSize: l.fontSize, letterSpacing: -l.fontSize * 0.03 }}>
          MD
          <div style={{ width: l.slashWidth, height: l.fontSize * 1.08, marginLeft: l.fontSize * 0.14, background: BLUE, transform: 'skewX(-14deg)' }} />
        </div>
      </div>
    ),
    { width: l.size, height: l.size },
  )
}
