'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { CampaignCreator, Creator } from '../../lib/creator-campaign-core'
import { AREA, FIELD, LABEL } from './stageWords'

/**
 * ADD A CREATOR, OR CHANGE ONE. A new creator is typed in, or picked from the agency's own list (everyone typed in
 * before) so nobody types the same person twice. The "why" and the terms belong to this campaign; the rest is the
 * creator's own profile. Version one never contacts the creator.
 */
export default function CreatorDialog({ campaignId, row, onClose, onSaved, onStale }: {
  campaignId: string
  /** the creator being changed; null = adding one */
  row: CampaignCreator | null
  onClose: () => void
  onSaved: (row: CampaignCreator) => void
  /** somebody changed this creator in between: the list is given them as they now stand, the dialog stays open */
  onStale: (row: CampaignCreator) => void
}) {
  const [picked, setPicked] = useState<Creator | null>(null)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Creator[]>([])
  const [name, setName] = useState(row?.name ?? '')
  const [photo, setPhoto] = useState(row?.photo_url ?? '')
  const [instagram, setInstagram] = useState(row?.instagram ?? '')
  const [igFollowers, setIgFollowers] = useState(row?.instagram_followers != null ? String(row.instagram_followers) : '')
  const [tiktok, setTiktok] = useState(row?.tiktok ?? '')
  const [ttFollowers, setTtFollowers] = useState(row?.tiktok_followers != null ? String(row.tiktok_followers) : '')
  const [why, setWhy] = useState(row?.why ?? '')
  const [terms, setTerms] = useState<'gifted' | 'paid'>(row?.terms ?? 'gifted')
  const [rate, setRate] = useState(row?.rate ?? '')
  /** the version this dialog saves on — moved forward when somebody else's change is shown, so Save can be pressed again */
  const [rev, setRev] = useState(row?.rev ?? 0)
  const [samples, setSamples] = useState((row?.samples ?? []).join('\n'))
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // the agency's list, as the name is typed — only when adding
  useEffect(() => {
    if (row || picked) return
    const needle = q.trim()
    if (needle.length < 2) { setFound([]); return }
    let live = true
    const t = setTimeout(() => {
      void fetch(`/api/creators/directory?q=${encodeURIComponent(needle)}`, { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : { creators: [] }))
        .then(j => { if (live) setFound((j.creators ?? []) as Creator[]) })
        .catch(() => { /* the list is a convenience; typing still works */ })
    }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [q, row, picked])

  const pick = (c: Creator) => {
    setPicked(c); setFound([])
    setName(c.name); setPhoto(c.photo_url ?? ''); setInstagram(c.instagram ?? ''); setTiktok(c.tiktok ?? '')
    setIgFollowers(c.instagram_followers != null ? String(c.instagram_followers) : '')
    setTtFollowers(c.tiktok_followers != null ? String(c.tiktok_followers) : '')
  }

  const upload = async (file: File) => {
    setUploading(true); setProblem(null)
    try {
      const form = new FormData(); form.set('file', file)
      const res = await fetch('/api/creators/photo', { method: 'POST', body: form })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setProblem(json?.error ?? 'That photo did not upload'); return }
      setPhoto(String(json.url))
    } catch {
      setProblem('That photo did not upload. Check the connection and try again.')
    } finally {
      setUploading(false)
    }
  }

  const save = async () => {
    setProblem(null)
    if (!name.trim()) { setProblem('Type the creator’s name'); return }
    const body = {
      name, photo_url: photo || null, instagram: instagram || null, tiktok: tiktok || null,
      instagram_followers: igFollowers.replace(/[,\s]/g, '') || null, tiktok_followers: ttFollowers.replace(/[,\s]/g, '') || null,
      why: why || null, terms, rate: terms === 'paid' ? rate || null : null,
      samples: samples.split('\n').map(s => s.trim()).filter(Boolean),
    }
    setBusy(true)
    try {
      const res = row
        ? await fetch(`/api/creators/${campaignId}/creators/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expect_rev: rev, ...body }) })
        : await fetch(`/api/creators/${campaignId}/creators`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(picked ? { creator_id: picked.id } : {}), ...body }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // somebody changed this creator in between (the client answered, a colleague moved them): nothing typed
        // here is lost and nothing of theirs is overwritten — say so, and Save again puts these details on top
        if (json?.fresh && row) {
          const now = json.fresh as CampaignCreator
          onStale(now); setRev(now.rev)
          setProblem('Somebody changed this creator while you were typing. Your changes are still here. Press Save again to keep them.'); return
        }
        setProblem(json?.error ?? 'That did not save'); return
      }
      toast.success(row ? 'Saved' : `${name.trim()} added as an idea`)
      onSaved(json.creator as CampaignCreator)
    } catch {
      setProblem('That did not save. Check the connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto bg-popover sm:max-w-[580px]">
        <DialogHeader>
          <DialogTitle>{row ? `Change ${row.name}` : 'Add a creator'}</DialogTitle>
          <DialogDescription>{row ? 'What the client reads about this creator.' : 'They start as an idea only the team sees. Show them to the client when you are ready.'}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3.5">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Name</span>
            <Input className="h-11" value={name} maxLength={120} placeholder="Type a name. Creators you added before show up to pick."
              onChange={e => { setName(e.target.value); if (!row) { setPicked(null); setQ(e.target.value) } }} />
          </label>
          {found.length > 0 && (
            <ul className="-mt-2 flex flex-col rounded-inner border border-border bg-surface" aria-label="Creators you added before">
              {found.slice(0, 6).map(c => (
                <li key={c.id}>
                  <button type="button" className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-[14px] hover:bg-foreground/[0.05]" onClick={() => pick(c)}>
                    <span className="font-medium">{c.name}</span>
                    <span className="text-muted-foreground">{[c.instagram && `@${c.instagram}`, c.tiktok && `TikTok @${c.tiktok}`].filter(Boolean).join(' · ')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {photo ? <img src={photo} alt="" className="h-14 w-14 shrink-0 rounded-full border border-border object-cover" />
              : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-[11px] text-muted-foreground">No photo</span>}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
            <Button type="button" variant="outline" className="h-11 rounded-full px-4 text-[13px]" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? 'Uploading…' : photo ? 'Change photo' : 'Add a photo'}
            </Button>
            {photo && <Button type="button" variant="ghost" className="h-11 px-3 text-[13px]" onClick={() => setPhoto('')}>Remove</Button>}
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Instagram</span>
              <Input className="h-11" value={instagram} onChange={e => setInstagram(e.target.value)} placeholder="@handle or profile link" />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Followers</span>
              <Input className="h-11" inputMode="numeric" value={igFollowers} onChange={e => setIgFollowers(e.target.value)} placeholder="17900" />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>TikTok</span>
              <Input className="h-11" value={tiktok} onChange={e => setTiktok(e.target.value)} placeholder="@handle or profile link" />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Followers</span>
              <Input className="h-11" inputMode="numeric" value={ttFollowers} onChange={e => setTtFollowers(e.target.value)} placeholder="4200" />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className={LABEL}>Why this creator</span>
            <textarea className={`${AREA} min-h-[84px]`} maxLength={1200} value={why} onChange={e => setWhy(e.target.value)} placeholder="The client reads this. Who follows them, why they fit." />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Terms</span>
              <select className={FIELD} value={terms} onChange={e => setTerms(e.target.value as 'gifted' | 'paid')}>
                <option value="gifted">Gifted</option>
                <option value="paid">Paid</option>
              </select>
            </label>
            {terms === 'paid' && (
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Rate</span>
                <Input className="h-11" value={rate} maxLength={120} onChange={e => setRate(e.target.value)} placeholder="$300 for the day" />
              </label>
            )}
          </div>

          <label className="flex flex-col gap-1">
            <span className={LABEL}>Links to their posts</span>
            <textarea className={`${AREA} min-h-[72px]`} value={samples} onChange={e => setSamples(e.target.value)} placeholder="One link on each line, up to six" />
          </label>

          {problem && <p role="alert" className="rounded-inner border border-accent-red/40 bg-tint-red px-3 py-2 text-[13px] font-medium">{problem}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" className="h-11 rounded-full px-4" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button className="h-11 rounded-full px-5 font-semibold" disabled={busy || uploading} onClick={() => void save()}>{busy ? 'Saving…' : row ? 'Save' : 'Add as an idea'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
