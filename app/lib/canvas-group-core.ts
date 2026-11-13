/**
 * THE TOOLBAR, ON EVERY PICKED CARD AT ONCE (the owner, 13 Nov 2026: "we should also be able to multi select and when
 * we use the toolbar like change colours, font size or delete should work, anything on the toolbar").
 *
 * Each change goes to the picked cards IT APPLIES TO and to no others: a colour to notes and to-dos, text size, text
 * colour, alignment and font to cards that carry words, exactly as the single card's toolbar offers them. A card the
 * change does not apply to is left as it was. Each function returns only the cards that actually changed, so one
 * save carries them and nothing else is rewritten. Pure.
 */

import {
  defaultAlignOf, hasFontChoice, hasTextStyle, minCardWidth, stepTextSize, textAlignOf, textColorOf, textSizeOf,
  type CanvasCard, type CanvasFont, fontOf,
} from './batch-brief-core'

type NoteColour = NonNullable<CanvasCard['color']>
type TextColour = NonNullable<ReturnType<typeof textColorOf>>
type Align = ReturnType<typeof textAlignOf>

const takesColour = (c: CanvasCard) => c.kind === 'note' || c.kind === 'todo'
const wordsOf = (c: CanvasCard) => (c.kind === 'todo' || c.kind === 'board' ? c.name : c.text)

/** which of the toolbar's groups this selection can use at all */
export function groupOffers(cards: readonly CanvasCard[]): { colour: boolean; text: boolean; font: boolean } {
  return { colour: cards.some(takesColour), text: cards.some(c => hasTextStyle(c.kind)), font: cards.some(c => hasFontChoice(c.kind)) }
}

/** the box's colour, on the notes and to-dos */
export function groupColour(cards: readonly CanvasCard[], colour: NoteColour): CanvasCard[] {
  return cards.filter(c => takesColour(c) && (c.color ?? 'paper') !== colour).map(c => ({ ...c, color: colour }))
}

/** one step bigger or smaller, each card from its own size; a card widens when its words need the room */
export function groupTextSize(cards: readonly CanvasCard[], dir: 1 | -1): CanvasCard[] {
  return cards.filter(c => hasTextStyle(c.kind)).flatMap(c => {
    const size = stepTextSize(textSizeOf(c), dir)
    if (size === textSizeOf(c)) return []
    return [{ ...c, size, w: Math.max(c.w, minCardWidth(c.kind, wordsOf(c) ?? undefined, size)) }]
  })
}

/** the words' colour. Pressed when every card already has it, it is taken off them all */
export function groupTextColour(cards: readonly CanvasCard[], colour: TextColour): CanvasCard[] {
  const withText = cards.filter(c => hasTextStyle(c.kind))
  const allHaveIt = withText.length > 0 && withText.every(c => textColorOf(c) === colour)
  return withText.filter(c => allHaveIt || textColorOf(c) !== colour).map(c => ({ ...c, text_color: allHaveIt ? undefined : colour }))
}

/** left, middle or right; a card's own default is stored as nothing, as the single toolbar stores it */
export function groupAlign(cards: readonly CanvasCard[], align: Align): CanvasCard[] {
  return cards.filter(c => hasTextStyle(c.kind) && textAlignOf(c) !== align).map(c => ({ ...c, align: align === defaultAlignOf(c.kind) ? undefined : align }))
}

/** the typeface, or '' for the default */
export function groupFont(cards: readonly CanvasCard[], font: CanvasFont | ''): CanvasCard[] {
  return cards.filter(c => hasFontChoice(c.kind) && (fontOf(c) ?? '') !== font).map(c => ({ ...c, font: font || undefined }))
}
