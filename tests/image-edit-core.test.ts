import { describe, it, expect } from 'vitest'
import {
  CROP_PRESETS, LOOKS, MAX_EXPORT_PX, MIN_CROP_PX, NEUTRAL_FILTERS,
  applyMatrix, clampCover, clampCrop, clampTextSpot, clampTrim, clockOf,
  arrowDelta, cropRectFor, derivedName, exportSize, filterMatrix,
  filtersAreNeutral, hasText, isWholeImage, matrixIsIdentity, nudgeStep,
  editMediaFooterLine, outputType, presetByKey, resizeCrop, saveDecision, textLayout,
  trimChanged, versionSaveWords, videoSaveDecision, wholeClip,
  type Rect,
} from '@/app/lib/image-edit-core'

/**
 * THE EDITOR'S ARITHMETIC, AND THE ONE RULE WITH AN APPROVAL RIDING ON IT.
 *
 * The crop maths is here because a box that drifts off the picture is a
 * silently corrupted export nobody sees until a client does. The save
 * decision is here because it is the difference between "the client already
 * said yes to this" and "the client has not seen this at all", and it is
 * decided by a pure function precisely so it can be pinned down.
 */

const IMAGE = { width: 4000, height: 3000 }

describe('crop presets put a real box on the picture', () => {
  it('freehand starts as the whole picture', () => {
    const r = cropRectFor(IMAGE, null)
    expect(r).toEqual({ x: 0, y: 0, width: 4000, height: 3000 })
    expect(isWholeImage(r, IMAGE)).toBe(true)
  })

  it('every preset fits inside the picture, centred, at the right shape', () => {
    for (const preset of CROP_PRESETS) {
      const r = cropRectFor(IMAGE, preset.ratio)
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.y).toBeGreaterThanOrEqual(0)
      expect(r.x + r.width).toBeLessThanOrEqual(IMAGE.width)
      expect(r.y + r.height).toBeLessThanOrEqual(IMAGE.height)
      // it touches at least one edge — anything smaller is throwing pixels away
      expect(r.width === IMAGE.width || r.height === IMAGE.height).toBe(true)
      if (preset.ratio) {
        expect(r.width / r.height).toBeCloseTo(preset.ratio, 2)
      }
      // centred: the margins match on both sides, give or take a rounding
      expect(Math.abs((IMAGE.width - r.width) / 2 - r.x)).toBeLessThanOrEqual(1)
      expect(Math.abs((IMAGE.height - r.height) / 2 - r.y)).toBeLessThanOrEqual(1)
    }
  })

  it('a tall shape on a wide picture is limited by the height', () => {
    const story = cropRectFor(IMAGE, presetByKey('story').ratio)
    expect(story.height).toBe(3000)
    expect(story.width).toBe(Math.round(3000 * 9 / 16))
  })

  it('a wide shape on a tall picture is limited by the width', () => {
    const wide = cropRectFor({ width: 1080, height: 1920 }, 16 / 9)
    expect(wide.width).toBe(1080)
    expect(wide.height).toBe(Math.round(1080 * 9 / 16))
  })
})

describe('a dragged crop cannot leave the picture', () => {
  const drags: Rect[] = [
    { x: -500, y: -500, width: 1000, height: 1000 },
    { x: 3900, y: 2900, width: 1000, height: 1000 },
    { x: 0, y: 0, width: 99999, height: 99999 },
    { x: 10, y: 10, width: -40, height: 2 },
  ]
  it('is always inside, whatever was dragged', () => {
    for (const d of drags) {
      const r = clampCrop(d, IMAGE)
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.y).toBeGreaterThanOrEqual(0)
      expect(r.width).toBeGreaterThanOrEqual(Math.min(MIN_CROP_PX, IMAGE.width))
      expect(r.height).toBeGreaterThanOrEqual(Math.min(MIN_CROP_PX, IMAGE.height))
      expect(r.x + r.width).toBeLessThanOrEqual(IMAGE.width)
      expect(r.y + r.height).toBeLessThanOrEqual(IMAGE.height)
    }
  })

  it('keeps the chosen shape while it is being resized', () => {
    const r = clampCrop({ x: 100, y: 100, width: 2000, height: 40 }, IMAGE, 1)
    expect(r.width).toBe(r.height)
  })

  it('a shape too big for the picture is shrunk, not squashed', () => {
    const r = clampCrop({ x: 0, y: 0, width: 4000, height: 4000 }, IMAGE, 9 / 16)
    expect(r.height).toBeLessThanOrEqual(IMAGE.height)
    expect(r.width / r.height).toBeCloseTo(9 / 16, 2)
  })

  it('a picture smaller than the minimum box still yields a usable box', () => {
    const tiny = { width: 8, height: 6 }
    const r = clampCrop({ x: 0, y: 0, width: 100, height: 100 }, tiny)
    expect(r).toEqual({ x: 0, y: 0, width: 8, height: 6 })
  })
})

describe('resizing from a corner holds the opposite one still', () => {
  const start = { x: 1000, y: 800, width: 1200, height: 1200 }

  it('the anchor does not move, whichever corner is dragged, at a fixed shape', () => {
    const anchors = {
      nw: { x: start.x + start.width, y: start.y + start.height },
      ne: { x: start.x, y: start.y + start.height },
      sw: { x: start.x + start.width, y: start.y },
      se: { x: start.x, y: start.y },
    } as const
    for (const corner of ['nw', 'ne', 'sw', 'se'] as const) {
      for (const [dx, dy] of [[120, 40], [-90, -30], [300, -300]]) {
        const r = resizeCrop(corner, start, dx, dy, IMAGE, 1)
        const anchor = anchors[corner]
        const gotX = corner === 'nw' || corner === 'sw' ? r.x + r.width : r.x
        const gotY = corner === 'nw' || corner === 'ne' ? r.y + r.height : r.y
        expect(Math.abs(gotX - anchor.x), `${corner} ${dx}`).toBeLessThanOrEqual(1)
        expect(Math.abs(gotY - anchor.y), `${corner} ${dy}`).toBeLessThanOrEqual(1)
        // and it is still a square
        expect(r.width / r.height).toBeCloseTo(1, 1)
      }
    }
  })

  it('stops at the edge instead of pushing the anchor off the picture', () => {
    const r = resizeCrop('se', start, 99999, 99999, IMAGE, null)
    expect(r.x).toBe(start.x)
    expect(r.y).toBe(start.y)
    expect(r.x + r.width).toBeLessThanOrEqual(IMAGE.width)
    expect(r.y + r.height).toBeLessThanOrEqual(IMAGE.height)
  })

  it('never collapses to nothing', () => {
    const r = resizeCrop('nw', start, 99999, 99999, IMAGE, null)
    expect(r.width).toBeGreaterThanOrEqual(1)
    expect(r.height).toBeGreaterThanOrEqual(1)
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.y).toBeGreaterThanOrEqual(0)
  })
})

describe('the keyboard can do what the pointer can', () => {
  it('one pixel a press, ten with Shift', () => {
    expect(nudgeStep(false)).toBe(1)
    expect(nudgeStep(true)).toBe(10)
  })

  it('reads the four arrow keys and lets everything else through', () => {
    expect(arrowDelta('ArrowLeft', false)).toEqual({ dx: -1, dy: 0 })
    expect(arrowDelta('ArrowRight', true)).toEqual({ dx: 10, dy: 0 })
    expect(arrowDelta('ArrowUp', false)).toEqual({ dx: 0, dy: -1 })
    expect(arrowDelta('ArrowDown', true)).toEqual({ dx: 0, dy: 10 })
    for (const key of ['Enter', 'Tab', 'a', ' ', 'Escape']) {
      expect(arrowDelta(key, false), key).toBeNull()
    }
  })
})

describe('what gets written out', () => {
  it('is the crop itself when it is a sane size', () => {
    expect(exportSize({ x: 0, y: 0, width: 1080, height: 1350 }))
      .toEqual({ width: 1080, height: 1350 })
  })

  it('brings an enormous crop down by its long side and keeps the shape', () => {
    const out = exportSize({ x: 0, y: 0, width: 8000, height: 4000 })
    expect(Math.max(out.width, out.height)).toBe(MAX_EXPORT_PX)
    expect(out.width / out.height).toBeCloseTo(2, 3)
  })

  it('keeps a PNG a PNG — JPEG would ruin flat graphics and transparency', () => {
    expect(outputType('https://x.invalid/card.png').mime).toBe('image/png')
    expect(outputType('https://x.invalid/shot.JPG').mime).toBe('image/jpeg')
    expect(outputType('https://x.invalid/card.png?v=2').mime).toBe('image/png')
  })

  it('names the file after the original so a folder of them can be read', () => {
    expect(derivedName('Hero shot.jpg', 'cropped')).toBe('Hero shot — cropped.jpg')
    expect(derivedName('Hero shot.jpg', 'edited')).toBe('Hero shot — edited.jpg')
    expect(derivedName('clip.mp4', 'cover')).toBe('clip — cover.jpg')
    expect(derivedName('', 'cropped')).toBe('picture — cropped.jpg')
  })
})

describe('filters are one definition, used by the screen and the file alike', () => {
  it('doing nothing does nothing', () => {
    expect(filtersAreNeutral(NEUTRAL_FILTERS)).toBe(true)
    expect(matrixIsIdentity(filterMatrix(NEUTRAL_FILTERS))).toBe(true)
  })

  it('brightness scales every channel', () => {
    const pixels = new Uint8ClampedArray([100, 100, 100, 255])
    applyMatrix(pixels, filterMatrix({ ...NEUTRAL_FILTERS, brightness: 150 }))
    expect([pixels[0], pixels[1], pixels[2]]).toEqual([150, 150, 150])
    // alpha is never touched: a transparent PNG corner stays transparent
    expect(pixels[3]).toBe(255)
  })

  it('contrast pivots on mid grey', () => {
    const grey = new Uint8ClampedArray([128, 128, 128, 255])
    applyMatrix(grey, filterMatrix({ ...NEUTRAL_FILTERS, contrast: 180 }))
    expect(grey[0]).toBeGreaterThanOrEqual(127)
    expect(grey[0]).toBeLessThanOrEqual(129)

    const dark = new Uint8ClampedArray([60, 60, 60, 255])
    applyMatrix(dark, filterMatrix({ ...NEUTRAL_FILTERS, contrast: 180 }))
    expect(dark[0]).toBeLessThan(60)
  })

  it('no colour at all is black and white', () => {
    const px = new Uint8ClampedArray([200, 40, 90, 255])
    applyMatrix(px, filterMatrix({ ...NEUTRAL_FILTERS, saturation: 0 }))
    expect(px[0]).toBe(px[1])
    expect(px[1]).toBe(px[2])
  })

  it('warmth moves red up and blue down together', () => {
    const warm = new Uint8ClampedArray([120, 120, 120, 255])
    applyMatrix(warm, filterMatrix({ ...NEUTRAL_FILTERS, warmth: 60 }))
    expect(warm[0]).toBeGreaterThan(120)
    expect(warm[2]).toBeLessThan(120)

    const cool = new Uint8ClampedArray([120, 120, 120, 255])
    applyMatrix(cool, filterMatrix({ ...NEUTRAL_FILTERS, warmth: -60 }))
    expect(cool[0]).toBeLessThan(120)
    expect(cool[2]).toBeGreaterThan(120)
  })

  it('never runs off the end of the scale', () => {
    const px = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255])
    applyMatrix(px, filterMatrix({ brightness: 200, contrast: 200, saturation: 200, warmth: 100 }))
    for (const v of px) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(255)
    }
  })

  it('every named look is a real change except "as shot"', () => {
    for (const look of LOOKS) {
      const neutral = filtersAreNeutral(look.filters)
      expect(neutral).toBe(look.key === 'none')
    }
  })
})

describe('the one line of text', () => {
  it('cannot be dragged off the picture', () => {
    expect(clampTextSpot({ x: -3, y: 9 })).toEqual({ x: 0, y: 1 })
    expect(clampTextSpot({ x: 0.5, y: 0.25 })).toEqual({ x: 0.5, y: 0.25 })
  })

  it('lands in the same place on the file as on the screen', () => {
    const line = { text: 'Open now', font: 'sans', size: 10, colour: '#fff', x: 0.5, y: 0.8 }
    const small = textLayout(line, { width: 400, height: 500 })
    const big = textLayout(line, { width: 2000, height: 2500 })
    // the same fraction across and down, and the same fraction of the height
    expect(small.x / 400).toBeCloseTo(big.x / 2000, 3)
    expect(small.y / 500).toBeCloseTo(big.y / 2500, 3)
    expect(small.fontPx / 500).toBeCloseTo(big.fontPx / 2500, 3)
  })

  it('an unknown font falls back rather than drawing nothing', () => {
    const t = textLayout(
      { text: 'x', font: 'nope', size: 8, colour: '#fff', x: 0.5, y: 0.5 },
      { width: 100, height: 100 })
    expect(t.font).toContain('Helvetica')
    expect(t.font).not.toContain('{px}')
  })

  it('whitespace is not a caption', () => {
    expect(hasText({ text: '   ', font: 'sans', size: 8, colour: '#fff', x: 0, y: 0 })).toBe(false)
    expect(hasText({ text: 'Hi', font: 'sans', size: 8, colour: '#fff', x: 0, y: 0 })).toBe(true)
  })
})

describe('THE RULE: which save this is, said before the button is pressed', () => {
  it('a crop keeps the approval, and the button says "Save crop"', () => {
    const plan = saveDecision({ cropped: true, filtered: false, text: false })
    expect(plan.kind).toBe('crop')
    expect(plan.label).toBe('Save crop')
    expect(plan.notice).toMatch(/approval stays/i)
    expect(plan.disabled).toBe(false)
  })

  it('a filter makes a new version, and the button says the client is asked', () => {
    const plan = saveDecision({ cropped: false, filtered: true, text: false })
    expect(plan.kind).toBe('version')
    expect(plan.label).toMatch(/needs client approval/i)
    expect(plan.notice).toMatch(/client is asked/i)
  })

  it('a line of text does too', () => {
    expect(saveDecision({ cropped: false, filtered: false, text: true }).kind).toBe('version')
  })

  it('a crop AND a filter is a new version — the stricter answer wins', () => {
    const plan = saveDecision({ cropped: true, filtered: true, text: false })
    expect(plan.kind).toBe('version')
    expect(plan.label).not.toBe('Save crop')
  })

  it('nothing changed offers nothing to press', () => {
    const plan = saveDecision({ cropped: false, filtered: false, text: false })
    expect(plan.kind).toBe('none')
    expect(plan.disabled).toBe(true)
  })

  it('the button never promises a crop while a filter is on — every case', () => {
    for (const cropped of [false, true]) {
      for (const filtered of [false, true]) {
        for (const text of [false, true]) {
          const plan = saveDecision({ cropped, filtered, text })
          if (filtered || text) expect(plan.kind).toBe('version')
          else if (cropped) expect(plan.kind).toBe('crop')
          else expect(plan.kind).toBe('none')
        }
      }
    }
  })
})

describe('THE WORDS: a new version means something different to each person', () => {
  const edit = { cropped: false, filtered: true, text: false }

  it('a picture no client ever approved just saves — no approval sentence at all', () => {
    const plan = saveDecision(edit, { clientApproved: false, mayApprove: true })
    expect(plan.kind).toBe('version')
    expect(plan.label).toBe('Save')
    expect(plan.notice).not.toMatch(/approv|client/i)
    // …and a scheduler editing the same upload gets the same answer
    expect(saveDecision(edit, { clientApproved: false, mayApprove: false }).label).toBe('Save')
  })

  it('somebody who may schedule it themselves is told the old yes is gone, and that they can', () => {
    const plan = saveDecision(edit, { clientApproved: true, mayApprove: true })
    expect(plan.kind).toBe('version')
    expect(plan.label).toBe('Save as new version')
    expect(plan.notice).toMatch(/earlier approval no longer covers it/)
    expect(plan.notice).toMatch(/schedule it yourself/)
    expect(plan.notice).not.toMatch(/client is asked/)
  })

  it('somebody who cannot is told the client is asked again — today’s words, unchanged', () => {
    const plan = saveDecision(edit, { clientApproved: true, mayApprove: false })
    expect(plan.label).toBe('Save as new version — needs client approval')
    expect(plan.notice).toMatch(/client is asked to look at it again before the post can go out/)
  })

  it('a caller that says nothing gets the strictest reading', () => {
    expect(saveDecision(edit)).toEqual(saveDecision(edit, { clientApproved: true, mayApprove: false }))
  })

  it('a crop keeps the approval whoever is pressing it', () => {
    for (const clientApproved of [false, true]) {
      for (const mayApprove of [false, true]) {
        const plan = saveDecision({ cropped: true, filtered: false, text: false }, { clientApproved, mayApprove })
        expect(plan.kind).toBe('crop')
        expect(plan.label).toBe('Save crop')
        expect(plan.notice).toMatch(/approval stays/i)
      }
    }
  })

  it('the three cases never share a label', () => {
    const labels = new Set([
      versionSaveWords({ clientApproved: false, mayApprove: false }).label,
      versionSaveWords({ clientApproved: true, mayApprove: true }).label,
      versionSaveWords({ clientApproved: true, mayApprove: false }).label,
    ])
    expect(labels.size).toBe(3)
  })

  it('the chooser’s footer keeps "Cropping keeps the client’s approval" for everybody', () => {
    for (const may of [false, true]) {
      expect(editMediaFooterLine(may)).toMatch(/^Cropping keeps the client’s approval\./)
    }
    expect(editMediaFooterLine(true)).toMatch(/schedule it yourself/)
    expect(editMediaFooterLine(false)).toMatch(/client is asked/)
  })
})

describe('video: trim marks and a cover frame, and no re-encoding', () => {
  it('the whole clip is the starting point', () => {
    expect(wholeClip(31.456)).toEqual({ start: 0, end: 31.46 })
    expect(trimChanged(wholeClip(30), 30)).toBe(false)
  })

  it('the end can never come before the start', () => {
    const t = clampTrim({ start: 20, end: 5 }, 30)
    expect(t.end).toBeGreaterThan(t.start)
    expect(t.end - t.start).toBeGreaterThanOrEqual(1)
  })

  it('neither mark leaves the clip', () => {
    const t = clampTrim({ start: -10, end: 999 }, 30)
    expect(t.start).toBe(0)
    expect(t.end).toBe(30)
  })

  it('a clip shorter than the minimum still gives a sane answer', () => {
    const t = clampTrim({ start: 0, end: 10 }, 0.4)
    expect(t.start).toBe(0)
    expect(t.end).toBeLessThanOrEqual(0.4)
  })

  it('the cover frame has to be inside the clip that is kept', () => {
    const trim = { start: 5, end: 12 }
    expect(clampCover(0, trim)).toBe(5)
    expect(clampCover(99, trim)).toBe(12)
    expect(clampCover(7.5, trim)).toBe(7.5)
  })

  it('neither control takes the approval away — the file is not touched', () => {
    const plan = videoSaveDecision({ coverChanged: true, trimmed: true })
    expect(plan.kind).toBe('crop')
    expect(plan.notice).toMatch(/approval stays/i)
    expect(plan.notice).toMatch(/untouched/i)
    expect(videoSaveDecision({ coverChanged: false, trimmed: false }).disabled).toBe(true)
  })

  it('says the time the way a person reads it', () => {
    expect(clockOf(7)).toBe('0:07')
    expect(clockOf(63)).toBe('1:03')
    expect(clockOf(3800)).toBe('1:03:20')
    expect(clockOf(-4)).toBe('0:00')
  })
})
