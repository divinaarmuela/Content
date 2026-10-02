/**
 * COLOUR GRADE (docs/COLOUR_GRADE_SPLIT_SPEC.md, the owner, 2 Oct 2026). Pure: which cards go to the colourist, and
 * whether a card at colour grade may go on to the client. No I/O — workflow.ts and the card screens ask here.
 */

/** the work kind of a video edit — the only kind graded (C1: "Every video edit"; graphics, copy, plans skip it) */
export const GRADED_KIND = 'edit'

/** C1: a video edit card's quality check passes to colour grade, never straight to the client */
export function needsColourGrade(kindSlug: string | null | undefined): boolean {
  return kindSlug === GRADED_KIND
}

/** the version a graded hand-in landed on — stamped by drive-handin.ts when a hand-in settles at colour grade */
export function gradedRoundOf(item: { graded_round?: unknown }): number | null {
  const n = Number(item.graded_round)
  return Number.isInteger(n) && n >= 1 ? n : null
}

/**
 * C5: may the graded cut go to the client? Only once a graded hand-in has landed for THIS version and nothing is still
 * copying. The words are the refusal, or null when it may go.
 */
export function gradeReadyProblem(item: { graded_round?: unknown }, round: number, copying: boolean): string | null {
  if (copying) return 'The graded files are still copying in from Google Drive — put it on the portal once they have landed'
  if (gradedRoundOf(item) !== round) return 'Hand in the graded Google Drive link first — the client sees the graded videos'
  return null
}

/** the button, in the colourist's words */
export const PUT_ON_PORTAL = "Put it on the client's portal"
