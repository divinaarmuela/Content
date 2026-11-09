/**
 * MD APP INBOX — the pure half (9 Nov 2026). The Meta card's Inbox tab: Instagram and Facebook Page comments (read,
 * reply, hide, delete) and Instagram / Messenger conversations (read, reply), each with the person's name and picture
 * (Business Asset User Profile Access). Built for Meta's App Review on the test client; no I/O here.
 *
 * Shapes are Meta's Graph API v27 answers:
 *   IG  /{media}/comments?fields=id,text,username,timestamp,hidden,from{id,username},replies{id,text,username,timestamp}
 *   FB  /{post}/comments?fields=id,message,created_time,is_hidden,from{id,name,picture},comments{id,message,created_time,from{id,name}}
 *   IG  /{ig}/conversations?platform=instagram&fields=id,updated_time,participants,messages{id,created_time,from,to,message}
 *   FB  /{page}/conversations?platform=messenger&fields=id,updated_time,participants,messages{id,created_time,from,to,message}
 */

export type InboxReply = { id: string; text: string; author: string; time: string | null; mine: boolean }
export type InboxComment = {
  id: string; text: string; author: string; authorId: string | null; picture: string | null
  time: string | null; hidden: boolean; mine: boolean; replies: InboxReply[]
}
export type InboxPost = { id: string; caption: string; time: string | null; comments: number; link: string | null; thumb: string | null }
export type InboxMessage = { id: string; text: string; fromMe: boolean; time: string | null }
export type InboxThread = {
  id: string; withId: string | null; withName: string; picture: string | null
  updated: string | null; messages: InboxMessage[]
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : Array.isArray((v as any)?.data) ? (v as any).data : [])
const byTime = <T extends { time: string | null }>(a: T, b: T) => (a.time ?? '').localeCompare(b.time ?? '')

export function parseIgPosts(json: unknown): InboxPost[] {
  return arr(json).filter(r => str(r?.id)).map(r => ({
    id: r.id, caption: str(r.caption) ?? '', time: str(r.timestamp), comments: Number(r.comments_count) || 0,
    link: str(r.permalink), thumb: str(r.thumbnail_url) ?? (r.media_type === 'VIDEO' ? null : str(r.media_url)),
  }))
}

export function parsePagePosts(json: unknown): InboxPost[] {
  return arr(json).filter(r => str(r?.id)).map(r => ({
    id: r.id, caption: str(r.message) ?? '', time: str(r.created_time),
    comments: Number(r.comments?.summary?.total_count) || 0, link: str(r.permalink_url), thumb: str(r.full_picture),
  }))
}

/** Instagram comments, oldest first. `own` is the account's username: its own replies are marked `mine`. */
export function parseIgComments(json: unknown, own: string | null): InboxComment[] {
  return arr(json).filter(r => str(r?.id)).map(r => {
    const author = str(r.username) ?? str(r.from?.username) ?? 'Someone'
    return {
      id: r.id, text: str(r.text) ?? '', author, authorId: str(r.from?.id), picture: null, time: str(r.timestamp),
      hidden: r.hidden === true, mine: !!own && author === own,
      replies: arr(r.replies).filter(x => str(x?.id)).map(x => {
        const by = str(x.username) ?? 'Someone'
        return { id: x.id, text: str(x.text) ?? '', author: by, time: str(x.timestamp), mine: !!own && by === own }
      }).sort(byTime),
    }
  }).sort(byTime)
}

/** Facebook Page comments, oldest first. `pageId`: the Page's own comments and replies are marked `mine`. */
export function parsePageComments(json: unknown, pageId: string): InboxComment[] {
  return arr(json).filter(r => str(r?.id)).map(r => ({
    id: r.id, text: str(r.message) ?? '', author: str(r.from?.name) ?? 'Someone', authorId: str(r.from?.id),
    picture: str(r.from?.picture?.data?.url), time: str(r.created_time), hidden: r.is_hidden === true,
    mine: str(r.from?.id) === pageId,
    replies: arr(r.comments).filter(x => str(x?.id)).map(x => ({
      id: x.id, text: str(x.message) ?? '', author: str(x.from?.name) ?? 'Someone', time: str(x.created_time), mine: str(x.from?.id) === pageId,
    })).sort(byTime),
  })).sort(byTime)
}

/**
 * Conversations, newest first; messages oldest first. `ownId` is the Instagram account id or the Page id — the other
 * participant is the person. Their name and picture are filled in afterwards from the profile read (withProfile).
 */
export function parseThreads(json: unknown, ownId: string): InboxThread[] {
  return arr(json).filter(r => str(r?.id)).map(r => {
    const people = arr(r.participants)
    const other = people.find(p => str(p?.id) && p.id !== ownId) ?? null
    const messages = arr(r.messages).filter(m => str(m?.id)).map(m => ({
      id: m.id, text: str(m.message) ?? '', fromMe: str(m.from?.id) === ownId, time: str(m.created_time),
    })).sort(byTime)
    return {
      id: r.id, withId: str(other?.id), withName: str(other?.username) ?? str(other?.name) ?? 'Someone', picture: null,
      updated: str(r.updated_time), messages,
    }
  }).sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''))
}

/** The profile read for one person (GET /{igsid or psid}?fields=name,username,profile_pic). */
export function withProfile(t: InboxThread, profile: unknown): InboxThread {
  const p = (profile ?? {}) as Record<string, unknown>
  return { ...t, withName: str(p.name) ?? str(p.username) ?? t.withName, picture: str(p.profile_pic) ?? t.picture }
}

/** A reply or message the person types: trimmed, not empty, at most 1000 characters (Meta's DM limit). */
export function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t && t.length <= 1000 ? t : null
}

/** The window Meta allows a standard reply in: 24 hours since the person's last message. */
export function canReplyNow(t: InboxThread, now: number): boolean {
  const last = [...t.messages].reverse().find(m => !m.fromMe)
  if (!last?.time) return false
  return now - Date.parse(last.time) < 24 * 60 * 60 * 1000
}

export const isGraphId = (v: unknown): v is string => typeof v === 'string' && /^[0-9_]{1,80}$/.test(v)
export const isThreadId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_:\-=]{1,200}$/.test(v)
