/**
 * A COMMENT ON ONE ASSET OF A POST.
 *
 * The owner, 8 Sep 2026, on the portal: "I sent 4 images for feedback, the
 * way it's showing on the client portal is only one and cut off … make sure
 * they can just leave comments on each asset." The comment thread is one
 * per piece, and the schema is not being widened for this — so a comment
 * about ONE slide carries which one in its first words, in a shape every
 * reader can show as a label and every human can read as a sentence:
 *
 *   "On photo 2 of 4: the logo is too small"
 *
 * `slideTag` writes it, `splitSlideTag` reads it back out.
 */

export function slideTag(index: number, total: number, type?: 'image' | 'video' | null): string {
  const what = type === 'video' ? 'video' : 'photo'
  return `On ${what} ${index + 1} of ${total}:`
}

export function tagComment(body: string, tag: string | null): string {
  const text = body.trim()
  return tag ? `${tag} ${text}` : text
}

const TAG = /^On (photo|video) (\d+) of (\d+):\s*/i

/** the label and the words, or no label and the words untouched */
export function splitSlideTag(body: string): { label: string | null; rest: string; index: number | null } {
  const m = TAG.exec(body)
  if (!m) return { label: null, rest: body, index: null }
  const what = m[1].toLowerCase() === 'video' ? 'Video' : 'Photo'
  return { label: `${what} ${m[2]} of ${m[3]}`, rest: body.slice(m[0].length), index: Number(m[2]) - 1 }
}

/** how many comments sit on each slide — the little count under an asset */
export function commentsBySlide(comments: readonly { body: string }[]): Map<number, number> {
  const out = new Map<number, number>()
  for (const c of comments) {
    const { index } = splitSlideTag(c.body)
    if (index === null) continue
    out.set(index, (out.get(index) ?? 0) + 1)
  }
  return out
}
