'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

/**
 * "Read who liked now" — the one press on the post page that talks to the
 * server, kept out of PostView so the page itself still fetches nothing on
 * load (tests/post-page pins that). The morning look reads people once a
 * day at 6 am; a manager can ask for them on the spot instead.
 */
export default function ReadPeopleButton({ postId, analyticsId, running, readBefore }: {
  postId: string
  analyticsId: string
  running: boolean
  readBefore: boolean
}) {
  const [busy, setBusy] = useState(false)
  const read = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/social/posts/${postId}/people`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analytics_id: analyticsId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(json?.error ?? 'Could not read the people'))
      toast.success(`Read: ${json.likers} liked, ${json.commenters} commented. The names appear below in a moment.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not read the people')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="outline" size="sm" disabled={busy || running} onClick={() => void read()}>
      {busy || running ? 'Reading…' : readBefore ? 'Read again' : 'Read who liked now'}
    </Button>
  )
}
