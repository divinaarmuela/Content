/**
 * The names of the sections people are SENT to, in one place.
 *
 * A success toast on the shoot page read "it's on Production, under Briefs in
 * flight". There is no "Briefs in flight" on Production — the heading said
 * "Briefs being planned", and a third code path said that correctly. Three
 * strings, two of them wrong, for one place on one screen.
 *
 * So the name is a constant: the heading and every toast that points at it
 * import the same value, and renaming the section renames every signpost with
 * it. "Shoot plans" is the glossary word — a plan the client signs off before
 * we film — and it is the word on the Production heading now.
 */
export const SHOOT_PLAN_SECTION = 'Shoot plans'

/** The other two Production sections, for the same reason. */
export const TASK_SECTION = 'Tasks'
export const SHOOTS_SECTION = 'Shoots'

/** The board's first column, where every new card lands — the column's own name. */
export const DRAFTING_LANE = 'Draft'
