/**
 * The names of the sections people are SENT to, in one place.
 *
 * A success toast once said "it's on Production, under Briefs in flight" while
 * the heading said something else. Three strings, two of them wrong, for one
 * place on one screen. So a name is a constant: the heading and every toast
 * that points at it import the same value, and renaming the section renames
 * every signpost with it.
 */

import { boardColumn } from './board-core'

/** The board's first column, where every new card lands — the board's own
 *  word for it, never a second spelling. */
export const DRAFTING_LANE = boardColumn('draft').label
