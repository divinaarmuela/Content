'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useRole } from '../useRole'
import PlatformIcon from '../social/PlatformIcon'

/**
 * THE AGENCY'S OWN FACEBOOK PAGE CONNECTION, FOR TESTING (6 Nov 2026) — the twin of MetaDirectInstagram.
 * Badged "Direct — testing". Connect → Facebook asks which Pages to share → back here, the person picks the
 * Page that belongs to this client (one Page is picked for them). Super admins pick, disconnect and flip the
 * switch that posts this client's Facebook through our own Meta app; an account manager on their own client
 * connects and reads comments and numbers. The Page token never reaches this page.
 * Messages: the Page's Messenger conversations, answered by a person inside Facebook's 24 hours.
 */

type PageRow = { id: string; name: string | null; category: string | null; picture: string | null; active: boolean; connected_at: string; last_error: string | null }
type State = { configured: boolean; reason: string | null; pages: PageRow[]; viaMeta: boolean } | { error: string }

const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export default function MetaDirectFacebook({ clientId }: { clientId: string }) {
  const { can, loading } = useRole()
  const superAdmin = can('super_admin')
  const mayConnect = can('account_manager')
  const [state, setState] = useState<State | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/meta/facebook/pages?clientId=${encodeURIComponent(clientId)}`)
      const json = await res.json().catch(() => ({}))
      setState(res.ok ? json as State : { error: (json as { error?: string }).error ?? 'Could not load' })
    } catch { setState({ error: 'Could not reach the server' }) }
  }, [clientId])

  useEffect(() => { if (mayConnect) void load() }, [mayConnect, load])

  // back from Facebook: say how it went once, then clear the query
  useEffect(() => {
    if (!mayConnect) return
    const params = new URLSearchParams(window.location.search)
    const result = params.get('meta_fb')
    if (!result) return
    if (result === 'connected') toast.success('Facebook Page connected')
    else if (result === 'pick') toast.success('Facebook is connected — now choose which Page belongs to this client')
    else if (result === 'denied') toast.error('Facebook connect was cancelled')
    else toast.error(`Facebook connect failed: ${params.get('reason') ?? 'unknown reason'}`)
    for (const k of ['meta_fb', 'reason']) params.delete(k)
    const qs = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
  }, [mayConnect])

  const send = async (method: 'POST' | 'PATCH', body: Record<string, unknown>, ok: string) => {
    setBusy(true)
    try {
      const res = await fetch('/api/meta/facebook/pages', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId, ...body }) })
      const json = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { toast.error(json.error ?? 'That did not work'); return }
      toast.success(ok)
      await load()
    } catch { toast.error('Could not reach the server') } finally { setBusy(false) }
  }

  if (loading || !mayConnect) return null

  const H = 'font-mono text-[12px] uppercase tracking-widest text-muted-foreground'
  const configured = state && 'configured' in state ? state.configured : false
  const pages = state && 'pages' in state ? state.pages : []
  const viaMeta = state && 'viaMeta' in state ? state.viaMeta : false
  const picked = pages.find(p => p.active) ?? null
  const candidates = pages.filter(p => !p.active)

  return (
    <div className="flex flex-col gap-2 rounded-inner border border-dashed border-border p-3" data-meta-fb="direct">
      <div className="flex flex-wrap items-center gap-2">
        <p className={H}>Facebook Page — our own Meta app</p>
        <span className="rounded-full bg-tint-amber px-2 py-0.5 text-[11px] font-semibold">Direct — testing</span>
      </div>
      <p className="text-[13px] text-muted-foreground">
        Connects this client’s Facebook Page straight to MD Media’s Meta app. Once connected, you can read and answer the Page’s comments and Messenger messages, and see its numbers, here.
      </p>
      {state && 'error' in state && <p className="text-[12px] text-accent-red-deep">{state.error}</p>}
      {state && 'reason' in state && state.reason && <p className="text-[12px] text-muted-foreground">{state.reason}</p>}

      {picked && (
        <div className="flex flex-wrap items-center gap-2 rounded-inner border border-border px-3 py-2 text-[13px]">
          {picked.picture ? <img src={picked.picture} alt="" className="h-6 w-6 rounded-full" /> : <PlatformIcon platform="facebook" size={16} />}
          <span className="font-semibold">{picked.name ?? picked.id}</span>
          {picked.category && <span className="text-muted-foreground">{picked.category}</span>}
          <span className="text-muted-foreground">· connected {day(picked.connected_at)}</span>
          {superAdmin && (
            <Button variant="ghost" disabled={busy} className="ml-auto h-11 px-3 text-[13px]"
              onClick={() => { if (window.confirm(`Disconnect ${picked.name ?? 'this Page'} from this client? Posts will go through Zernio.`)) void send('POST', { action: 'disconnect', pageId: picked.id }, 'Page disconnected') }}>
              Disconnect
            </Button>
          )}
          {picked.last_error && <span className="w-full text-[12px] text-muted-foreground">{picked.last_error}</span>}
        </div>
      )}

      {candidates.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[13px] font-semibold">{picked ? 'Other Pages you shared' : 'Which Page belongs to this client?'}</p>
          <ul className="flex flex-col gap-1.5" aria-label="Facebook Pages to choose from">
            {candidates.map(p => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-inner border border-border px-3 py-2 text-[13px]">
                <PlatformIcon platform="facebook" size={16} />
                <span className="font-semibold">{p.name ?? p.id}</span>
                {p.category && <span className="text-muted-foreground">{p.category}</span>}
                {superAdmin
                  ? <Button variant="outline" disabled={busy} className="ml-auto h-11 rounded-full px-4 text-[13px]" onClick={() => void send('POST', { action: 'pick', pageId: p.id }, `${p.name ?? 'Page'} is now this client’s Page`)}>Use this Page</Button>
                  : <span className="ml-auto text-[12px] text-muted-foreground">A super admin chooses</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        {configured ? (
          <Button asChild variant="outline" className="h-11 rounded-full px-4 text-[13px] font-semibold">
            <a href={`/api/meta/facebook/connect?clientId=${encodeURIComponent(clientId)}`}>
              <PlatformIcon platform="facebook" size={16} className="mr-1.5" /> Connect Facebook Page (Meta)
            </a>
          </Button>
        ) : (
          <Button variant="outline" disabled className="h-11 rounded-full px-4 text-[13px] font-semibold">
            <PlatformIcon platform="facebook" size={16} className="mr-1.5" /> Connect Facebook Page (Meta)
          </Button>
        )}
      </div>

      {picked && <FacebookPagePanel clientId={clientId} />}

      {superAdmin && (
        <label className="flex min-h-11 items-center gap-3 border-t border-border pt-2 text-[13px]">
          <Switch checked={viaMeta} disabled={busy || !state || 'error' in state || (!viaMeta && !picked)}
            onCheckedChange={v => void send('PATCH', { viaMeta: v }, v ? 'Facebook posts for this client now go through Meta' : 'Facebook posts for this client go through Zernio again')}
            aria-label="Post this client's Facebook through Meta" />
          <span className="flex flex-col">
            <span className="font-semibold">Post this client’s Facebook through Meta</span>
            <span className="text-[12px] text-muted-foreground">
              {viaMeta ? 'On: Facebook posts booked from now on go out through our own Meta app. Other networks still go through Zernio.'
                : picked ? 'Off: everything goes through Zernio.' : 'Connect and choose the Page first.'}
            </span>
          </span>
        </label>
      )}
    </div>
  )
}

/* ── comments and numbers for the picked Page ─────────────────────────── */

type Post = { id: string; message: string | null; at: string | null; permalink: string | null; picture: string | null; comments: number | null; reactions: number | null }
type Comment = { id: string; text: string; name: string | null; at: string | null; hidden: boolean; canHide: boolean; ours: boolean; replies: Comment[] }
type Insight = { metric: string; label: string; value: number | null }
type Conversation = { id: string; updatedAt: string | null; personId: string | null; personName: string | null; canReply: boolean; messages: { id: string; text: string; at: string | null; ours: boolean }[] }

function FacebookPagePanel({ clientId }: { clientId: string }) {
  const [tab, setTab] = useState<'comments' | 'messages' | 'insights'>('comments')
  const [convs, setConvs] = useState<Conversation[] | null>(null)
  const [openConv, setOpenConv] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [postId, setPostId] = useState<string | null>(null)
  const [comments, setComments] = useState<Comment[] | null>(null)
  const [postNumbers, setPostNumbers] = useState<Insight[]>([])
  const [numbers, setNumbers] = useState<{ followers: number | null; page: Insight[]; pageError: string | null; days: number } | null>(null)
  const [days, setDays] = useState(7)
  const [error, setError] = useState<string | null>(null)
  const [reply, setReply] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const get = useCallback(async (q: string) => {
    const res = await fetch(`/api/meta/facebook/inbox?clientId=${encodeURIComponent(clientId)}&${q}`)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((json as { error?: string }).error ?? 'Could not load')
    return json
  }, [clientId])

  useEffect(() => {
    setError(null)
    if (tab === 'comments' && posts === null) get('view=posts').then(j => setPosts(j.posts ?? [])).catch(e => setError(e.message))
    if (tab === 'insights') get(`view=insights&days=${days}`).then(j => setNumbers(j)).catch(e => setError(e.message))
    if (tab === 'messages' && convs === null) get('view=messages').then(j => setConvs(j.conversations ?? [])).catch(e => setError(e.message))
  }, [tab, days, posts, convs, get])

  const sendMessage = async (c: Conversation) => {
    if (!c.personId || !draft.trim()) return
    setBusy(true)
    try {
      const res = await fetch('/api/meta/facebook/inbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId, action: 'message', recipientId: c.personId, text: draft }) })
      const json = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { toast.error(json.error ?? 'Facebook said no'); return }
      toast.success('Message sent')
      setDraft('')
      const j = await get('view=messages'); setConvs(j.conversations ?? [])
    } catch { toast.error('Could not reach the server') } finally { setBusy(false) }
  }

  const openPost = useCallback(async (id: string) => {
    setPostId(id); setComments(null); setError(null)
    try { const j = await get(`view=comments&postId=${encodeURIComponent(id)}`); setComments(j.comments ?? []); setPostNumbers(j.insights ?? []) }
    catch (e) { setError((e as Error).message) }
  }, [get])

  const act = async (action: 'reply' | 'hide' | 'unhide' | 'delete', commentId: string) => {
    if (action === 'delete' && !window.confirm('Delete this comment from Facebook? This cannot be undone.')) return
    setBusy(true)
    try {
      const res = await fetch('/api/meta/facebook/inbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId, action, commentId, text: reply[commentId] }) })
      const json = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { toast.error(json.error ?? 'Facebook said no'); return }
      toast.success(action === 'reply' ? 'Reply posted' : action === 'delete' ? 'Comment deleted' : action === 'hide' ? 'Comment hidden' : 'Comment shown again')
      setReply(r => ({ ...r, [commentId]: '' }))
      if (postId) await openPost(postId)
    } catch { toast.error('Could not reach the server') } finally { setBusy(false) }
  }

  const tabBtn = (t: typeof tab, label: string) => (
    <Button variant={tab === t ? 'default' : 'outline'} className="h-11 rounded-full px-4 text-[13px]" onClick={() => setTab(t)}>{label}</Button>
  )

  const one = (c: Comment, depth: number) => (
    <li key={c.id} className={`flex flex-col gap-1 rounded-inner border border-border px-3 py-2 text-[13px] ${depth ? 'ml-6' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{c.ours ? 'The Page' : c.name ?? 'Someone'}</span>
        <span className="text-[12px] text-muted-foreground">{c.at ? new Date(c.at).toLocaleString('en-AU') : ''}</span>
        {c.hidden && <span className="rounded-full bg-tint-amber px-2 py-0.5 text-[11px]">Hidden</span>}
      </div>
      <p>{c.text}</p>
      <div className="flex flex-wrap gap-1">
        {!c.ours && c.canHide && <Button variant="ghost" disabled={busy} className="h-11 px-3 text-[13px]" onClick={() => void act(c.hidden ? 'unhide' : 'hide', c.id)}>{c.hidden ? 'Show' : 'Hide'}</Button>}
        <Button variant="ghost" disabled={busy} className="h-11 px-3 text-[13px]" onClick={() => void act('delete', c.id)}>Delete</Button>
      </div>
      {depth === 0 && (
        <div className="flex gap-2">
          <input value={reply[c.id] ?? ''} onChange={e => setReply(r => ({ ...r, [c.id]: e.target.value }))} placeholder="Write a reply as the Page"
            className="h-11 flex-1 rounded-inner border border-border bg-background px-3 text-[13px]" aria-label="Reply" />
          <Button disabled={busy || !(reply[c.id] ?? '').trim()} className="h-11 rounded-full px-4 text-[13px]" onClick={() => void act('reply', c.id)}>Reply</Button>
        </div>
      )}
      {c.replies.length > 0 && <ul className="flex flex-col gap-1">{c.replies.map(r => one(r, 1))}</ul>}
    </li>
  )

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-2" data-meta-fb="inbox">
      <div className="flex flex-wrap gap-2">{tabBtn('comments', 'Comments')}{tabBtn('messages', 'Messages')}{tabBtn('insights', 'Numbers')}</div>

      {tab === 'messages' && (
        <div className="flex flex-col gap-2">
          {convs === null && !error && <p className="text-[13px] text-muted-foreground">Loading Messenger conversations…</p>}
          {convs && convs.length === 0 && <p className="text-[13px] text-muted-foreground">No one has messaged this Page yet.</p>}
          {convs && convs.length > 0 && (
            <ul className="flex flex-col gap-1.5" aria-label="Messenger conversations">
              {convs.map(c => (
                <li key={c.id} className="flex flex-col gap-1 rounded-inner border border-border px-3 py-2 text-[13px]">
                  <button type="button" className="flex min-h-11 items-center gap-2 text-left" onClick={() => { setOpenConv(openConv === c.id ? null : c.id); setDraft('') }}>
                    <span className="font-semibold">{c.personName ?? 'Someone'}</span>
                    <span className="line-clamp-1 flex-1 text-muted-foreground">{c.messages[c.messages.length - 1]?.text ?? ''}</span>
                  </button>
                  {openConv === c.id && (
                    <div className="flex flex-col gap-1">
                      {c.messages.map(m => (
                        <p key={m.id} className={`max-w-[85%] rounded-inner px-3 py-1.5 ${m.ours ? 'self-end bg-tint-amber' : 'self-start border border-border'}`}>{m.text || '(attachment)'}</p>
                      ))}
                      {c.canReply ? (
                        <div className="flex gap-2">
                          <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Write a message as the Page"
                            className="h-11 flex-1 rounded-inner border border-border bg-background px-3 text-[13px]" aria-label="Message" />
                          <Button disabled={busy || !draft.trim()} className="h-11 rounded-full px-4 text-[13px]" onClick={() => void sendMessage(c)}>Send</Button>
                        </div>
                      ) : (
                        <p className="text-[12px] text-muted-foreground">Facebook only lets a Page answer within 24 hours of the person’s last message, so this one can’t be answered from here.</p>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p className="text-[12px] text-accent-red-deep">{error}</p>}

      {tab === 'comments' && (
        <div className="flex flex-col gap-2">
          {posts === null && !error && <p className="text-[13px] text-muted-foreground">Loading the Page’s posts…</p>}
          {posts && posts.length === 0 && <p className="text-[13px] text-muted-foreground">This Page has no posts yet.</p>}
          {posts && posts.length > 0 && (
            <ul className="flex flex-col gap-1" aria-label="The Page's recent posts">
              {posts.map(p => (
                <li key={p.id}>
                  <button type="button" onClick={() => void openPost(p.id)}
                    className={`flex min-h-11 w-full items-center gap-2 rounded-inner border px-3 py-2 text-left text-[13px] ${postId === p.id ? 'border-foreground' : 'border-border'}`}>
                    {p.picture && <img src={p.picture} alt="" className="h-9 w-9 rounded object-cover" />}
                    <span className="line-clamp-1 flex-1">{p.message ?? '(no words)'}</span>
                    <span className="text-[12px] text-muted-foreground">{p.comments ?? 0} comments</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {postId && postNumbers.length > 0 && (
            <p className="text-[12px] text-muted-foreground">{postNumbers.map(n => `${n.label}: ${n.value ?? '—'}`).join(' · ')}</p>
          )}
          {postId && comments === null && !error && <p className="text-[13px] text-muted-foreground">Loading comments…</p>}
          {comments && comments.length === 0 && <p className="text-[13px] text-muted-foreground">No comments on this post yet.</p>}
          {comments && comments.length > 0 && <ul className="flex flex-col gap-1.5">{comments.map(c => one(c, 0))}</ul>}
        </div>
      )}

      {tab === 'insights' && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            {[7, 28].map(d => <Button key={d} variant={days === d ? 'default' : 'outline'} className="h-11 rounded-full px-4 text-[13px]" onClick={() => setDays(d)}>Last {d} days</Button>)}
          </div>
          {numbers === null && !error && <p className="text-[13px] text-muted-foreground">Loading…</p>}
          {numbers && (
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="rounded-inner border border-border px-3 py-2"><dt className="text-[12px] text-muted-foreground">Followers now</dt><dd className="text-[18px] font-semibold">{numbers.followers ?? '—'}</dd></div>
              {numbers.page.filter(n => n.metric !== 'page_follows').map(n => (
                <div key={n.metric} className="rounded-inner border border-border px-3 py-2"><dt className="text-[12px] text-muted-foreground">{n.label}</dt><dd className="text-[18px] font-semibold">{n.value ?? '—'}</dd></div>
              ))}
            </dl>
          )}
          {numbers?.pageError && <p className="text-[12px] text-muted-foreground">Facebook did not give some numbers: {numbers.pageError}</p>}
        </div>
      )}
    </div>
  )
}
