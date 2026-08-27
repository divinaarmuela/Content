/**
 * The names of the sections people are SENT to, in one place.
 *
 * A success toast on the shoot page read "it's on Production, under Briefs in
 * flight". There is no "Briefs in flight" on Production — the heading says
 * "Briefs being planned", and a third code path said that correctly. Three
 * strings, two of them wrong, for one place on one screen.
 *
 * So the name is a constant: the heading and every toast that points at it
 * import the same value, and renaming the section renames every signpost with
 * it. (The rename itself — "Shoot plans" — lands with the Production board.)
 */
export const SHOOT_PLAN_SECTION = 'Briefs being planned'
