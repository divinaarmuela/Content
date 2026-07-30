import type { Metadata } from 'next'
import VoidScene from './VoidScene'

/**
 * PRIVATE TEST PAGE — lusion.co astronaut sequence replication study.
 * Uses Lusion's own assets (© Lusion) purely to verify we can rebuild the
 * technique. Never link, deploy, or index this route.
 */
export const metadata: Metadata = {
  title: 'Void Test (private)',
  robots: 'noindex, nofollow',
}

export default function VoidTestPage() {
  return (
    <main className="vt-page">
      <section className="vt-intro">
        <p className="vt-intro-tag">· REPLICATION TEST · PRIVATE ·</p>
        <h1 className="vt-intro-h1">The card is a door.</h1>
        <p className="vt-intro-sub">Keep scrolling.</p>
      </section>

      <VoidScene />

      <section className="vt-outro">
        <h2 className="vt-outro-h2">…and he&rsquo;s gone.</h2>
        <p className="vt-outro-sub">
          Scroll back up — the sequence scrubs in both directions, exactly like theirs.
        </p>
      </section>
    </main>
  )
}
