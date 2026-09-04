import 'server-only'
import { table } from '@/lib/db'
import { announceAfter } from '@/lib/live'
import type { AssetVersion, ContentItem, SocialPost } from '@/lib/db-types'
import { AuthzError, type TeamUser } from './authz'
import { loadItemForUser } from './production-access'
import { mayCompose } from './social-schedule'
import { slidesOf, type Slide } from './version-files-core'
import { mirrorVersionSlides } from './gdrive-mirror'
import { ourStorageUrl, storedFileIsUsable } from './storage-core'
import { MAX_DERIVED_BYTES, deleteStoredObject, headStoredObject, publicBase } from './storage'

/**
 * SAVING AN EDIT THAT KEEPS THE CLIENT'S APPROVAL.
 *
 * There are exactly two of those, and this is the only door either goes
 * through:
 *
 *  1. A CROP. The same picture in a tighter frame. The derived file replaces
 *     the slide inside the version the client already said yes to, and the
 *     approval is not touched — because nothing the client looked at has
 *     changed except how much of it is showing.
 *  2. A VIDEO's cover frame and trim marks. Neither rewrites the file: we
 *     never re-encode somebody's footage in a browser, so the cover is a
 *     still lifted out of the clip that was already approved and the marks
 *     are an instruction that travels with it.
 *
 * Everything else — a filter, a caption burnt into the picture — is a
 * DIFFERENT picture and goes through `addMediaVersion` instead, which makes a
 * new version and sends the piece back to the client. That split is decided
 * on screen by `saveDecision` in `image-edit-core.ts` and enforced here by
 * this file simply not being able to do the other thing: there is no path in
 * it that writes a new file the client has not approved into a post.
 */

export type DeriveKind = 'crop' | 'video'

/** A post whose media can still change — the same split `updatePost` enforces
 *  (`SETTLED` there), read from the one list of post statuses. */
const STILL_CHANGEABLE: string[] = ['draft', 'pending', 'approved', 'changes', 'scheduled']

export type DeriveInput = {
  item_id: string
  /** which version to write into. Omitted = whichever one holds `from_url`. */
  version_number?: number | null
  /** the file being edited, as it is today */
  from_url: string
  /** the cropped file, already uploaded. Required for a crop. */
  to_url?: string | null
  /** a still lifted out of a video, already uploaded */
  cover_url?: string | null
  trim_start?: number | null
  trim_end?: number | null
  kind: DeriveKind
}

export type DeriveResult = {
  version_number: number
  slides: Slide[]
  message: string
}

/** The file being EDITED. Loose on purpose: it is only ever used to find a
 *  slide that already exists on the version, so a URL that is not one of ours
 *  matches nothing and the request is refused a line later. */
const knownUrl = (v: unknown): string | null => {
  const s = String(v ?? '').trim()
  return /^https:\/\/\S+$/i.test(s) ? s : null
}

/**
 * The file being WRITTEN IN, checked properly.
 *
 * This is the guard the whole "a crop keeps the client's approval" promise
 * rests on. The route swaps this file into a version that is already approved
 * and repoints the live post at it, so anything it accepts is published under
 * an approval nobody gave for it. Checking the scheme alone (which is all it
 * used to do) meant any URL on the internet would go in.
 *
 * Three questions, all of them cheap:
 *   1. is it on OUR public storage host, with a key shaped like the ones
 *      `objectKey()` mints, and no traversal in it (`storage-core.ts`);
 *   2. does the extension match what it is being used as;
 *   3. does the host itself say it is a picture, and a sane size (one HEAD).
 */
async function ourPicture(
  value: unknown, what: string,
): Promise<string> {
  const url = ourStorageUrl(value, publicBase(), 'image')
  if (!url) {
    throw new AuthzError(
      `${what} is not one of our own files. Save it again, and if it keeps happening tell us.`,
      400,
    )
  }
  const verdict = storedFileIsUsable(
    await headStoredObject(url), 'image', MAX_DERIVED_BYTES)
  if (!verdict.ok) throw new AuthzError(`${what}: ${verdict.why}`, 400)
  return url
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null

/**
 * The file the browser uploaded a moment ago, thrown away when the save it was
 * uploaded FOR does not happen.
 *
 * The crop path cannot upload after the write — the write needs a URL — so a
 * refusal (somebody else changed the piece; the file is not what it claimed to
 * be) would otherwise leave bytes in the bucket nothing points at. Best effort:
 * a failed tidy-up must never turn into a failed edit.
 */
async function dropOrphan(url: unknown): Promise<void> {
  const ours = ourStorageUrl(url, publicBase(), 'image')
  if (ours) await deleteStoredObject(ours).catch(() => {})
}

export async function saveDerived(user: TeamUser, input: DeriveInput): Promise<DeriveResult> {
  try {
    return await write(user, input)
  } catch (e) {
    // whichever file this save was going to use is now rubbish
    await dropOrphan(input.kind === 'video' ? input.cover_url : input.to_url)
    throw e
  }
}

async function write(user: TeamUser, input: DeriveInput): Promise<DeriveResult> {
  const item = await loadItemForUser(user, String(input.item_id ?? '')) as ContentItem
  if (!mayCompose(user, item)) {
    throw new AuthzError('Only the people scheduling this client can change this media', 403)
  }

  const from = knownUrl(input.from_url)
  if (!from) throw new AuthzError('Which picture is being edited?', 400)

  const versions = await table<AssetVersion>('asset_versions')
    .list({ where: v => v.item_id === item.id, orderBy: [['version_number', 'desc']] })

  // the version the client is looking at that actually holds this file. Asked
  // for by number when the caller knows it, and otherwise the NEWEST one
  // carrying the file — never "the newest version", which on a piece that has
  // moved on would silently edit something else.
  const wanted = num(input.version_number)
  const version = versions.find(v =>
    (wanted === null || Number(v.version_number) === wanted)
    && slidesOf(v).some(s => s.url === from))
  if (!version) {
    throw new AuthzError('That picture is not part of this piece any more — reopen it and try again', 409)
  }
  const number = Number(version.version_number ?? 0)
  const before = slidesOf(version)

  if (input.kind === 'crop') {
    const to = await ourPicture(input.to_url, 'The cropped picture')

    const after = before.map(s => (s.url === from ? { ...s, url: to } : s))

    // claim, never check-then-write: two people cropping two slides of the
    // same carousel at once must both survive, and the loser of a race must
    // be told rather than silently overwritten (CLAUDE.md trap 11)
    const taken = await table<AssetVersion>('asset_versions').claim(version.id, cur => {
      if (!cur) return null
      const live = slidesOf(cur)
      if (!live.some(s => s.url === from)) return null
      const next = live.map(s => (s.url === from ? { ...s, url: to } : s))
      return {
        ...cur,
        files: next as unknown as AssetVersion['files'],
        file_url: cur.file_url === from ? to : cur.file_url,
      }
    })
    if (!taken.claimed) {
      throw new AuthzError('Somebody changed this piece while you were cropping — reopen it and try again', 409)
    }

    const slides = slidesOf(taken.row)
    mirrorVersionSlides(item.id, number, slides)
    await repointPosts(item.id, from, to)
    announceAfter('schedule', { client_id: item.client_id, item_id: item.id, kind: 'media' })

    return {
      version_number: number,
      slides,
      message: `Cropped. Version ${number} keeps the client’s approval — it is the same picture, tighter.`,
    }
  }

  /* ── a video's cover frame and trim marks ─────────────────────────────── */

  const cover = input.cover_url === undefined || input.cover_url === null
    ? undefined
    : await ourPicture(input.cover_url, 'The cover picture')
  const start = num(input.trim_start)
  const end = num(input.trim_end)

  const taken = await table<AssetVersion>('asset_versions').claim(version.id, cur => {
    if (!cur) return null
    return {
      ...cur,
      ...(cover === undefined ? {} : { cover_url: cover }),
      ...(start === null ? {} : { trim_start: start }),
      ...(end === null ? {} : { trim_end: end }),
    }
  })
  if (!taken.claimed) {
    throw new AuthzError('Somebody changed this piece while you were editing — reopen it and try again', 409)
  }

  announceAfter('schedule', { client_id: item.client_id, item_id: item.id, kind: 'media' })

  const said: string[] = []
  if (cover) said.push('the cover frame')
  if (start !== null || end !== null) said.push('where the clip starts and ends')
  return {
    version_number: number,
    slides: slidesOf(taken.row),
    message: said.length > 0
      ? `Saved ${said.join(' and ')}. The video itself is untouched, so the client’s approval stays.`
      : 'Nothing to save.',
  }
}

/**
 * A post already holding the old file follows the crop.
 *
 * Without this, the version says "cropped" and the post that was built from
 * it still points at the uncropped file — and the uncropped one is what would
 * be published. The claim only fires on a post that is still holding the old
 * url, so a post somebody has since re-picked media on is left alone.
 *
 * A post that has ALREADY GONE OUT is left alone too, and that is the more
 * important half. `social_posts.slides` is the record of what was published;
 * rewriting it because somebody cropped the same picture for reuse next month
 * makes the Preview grid and the post detail show history that did not
 * happen. Only a post that can still change is still a plan.
 */
async function repointPosts(itemId: string, from: string, to: string): Promise<void> {
  const rows = await table<SocialPost>('social_posts').list({ where: p => p.item_id === itemId })
  for (const row of rows) {
    if (!STILL_CHANGEABLE.includes(String(row.status))) continue
    const slides = Array.isArray(row.slides) ? (row.slides as unknown as Slide[]) : []
    if (!slides.some(s => s?.url === from)) continue
    await table<SocialPost>('social_posts').claim(row.id, cur => {
      if (!cur) return null
      if (!STILL_CHANGEABLE.includes(String(cur.status))) return null
      const live = Array.isArray(cur.slides) ? (cur.slides as unknown as Slide[]) : []
      if (!live.some(s => s?.url === from)) return null
      return {
        ...cur,
        slides: live.map(s =>
          (s?.url === from ? { ...s, url: to } : s)) as unknown as SocialPost['slides'],
      }
    }).catch(() => ({ claimed: false }))
  }
}
