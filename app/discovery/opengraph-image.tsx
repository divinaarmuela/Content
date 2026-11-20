import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'

/**
 * THE PICTURE A CHAT APP SHOWS FOR THE DISCOVERY LINK (the owner, 20 Nov 2026, of the link pasted into Slack: "is that
 * thumbnail broken"). The page offered no picture at all, so the preview drew an empty box. This is the page's own
 * face — ink, the blue light, the logo and the headline — made here, so it never depends on another site being up.
 */
export const alt = 'MD Media: tell us about your business'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
  // the logo as it is (light on transparent): never recoloured
  const logo = await readFile(join(process.cwd(), 'public', 'MDLogo-trim.png'))
  const src = `data:image/png;base64,${logo.toString('base64')}`
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '72px 80px', background: 'linear-gradient(165deg, #1b3f8f 0%, #14285c 30%, #0d1530 58%, #0B0B0B 82%)', color: '#f9f4eb' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" height={44} style={{ height: 44, objectFit: 'contain', objectPosition: 'left', alignSelf: 'flex-start' }} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 104, fontWeight: 600, lineHeight: 1, letterSpacing: -4, display: 'flex', flexDirection: 'column' }}>
            <span>Tell us about</span>
            <span>your business.</span>
          </div>
          <div style={{ marginTop: 30, fontSize: 30, color: 'rgba(249,244,235,0.7)', display: 'flex' }}>A few short questions before our first conversation.</div>
        </div>
      </div>
    ),
    size,
  )
}
