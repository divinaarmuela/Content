'use client'

/**
 * PICKING A POST UP AND PUTTING IT DOWN SOMEWHERE ELSE.
 *
 * Three ways, because a calendar you can only use with a mouse is a calendar
 * half the team cannot use:
 *
 *   MOUSE     native drag events, the same ones the media rail already uses,
 *             so a tile and a rail card behave identically.
 *   TOUCH     a long press lifts the tile — and a finger that MOVES before the
 *             press is long enough is scrolling the week, not picking anything
 *             up. Nothing stops the page scrolling until a tile is actually in
 *             the air, at which point the page stops moving under it.
 *   KEYBOARD  focus a tile, Space picks it up (Enter still opens it), the
 *             arrows move it by half an hour or a day, Enter puts it down,
 *             Escape puts it back.
 *
 * All three end in the same place: `commit()`. The move shows IMMEDIATELY —
 * the tile is where you dropped it before the server has answered, because a
 * tile that hangs where it was for half a second reads as "it did not work"
 * and gets dragged again. The instant the server answers, the drawn time is
 * dropped and the LISTENER is in charge again, whether the answer was yes or
 * no; a refusal snaps the tile back and shows the server's own sentence,
 * never one written here.
 *
 * What that sequence does to the screen is `schedule-drag-core`'s `MoveState`
 * — pure, and tested without a browser (this repo has no DOM test renderer).
 * This file is the hands: timers, listeners, focus.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  beginMove, dragBlockReason, finishMove, GRID_HOURS, keyboardMove, LONG_PRESS_MS,
  movingAnnouncement, NO_MOVES, recentlyMoved as isRecentlyMoved, settledIds, shouldCommit,
  type HourWindow, type MoveState, type SettlablePost,
} from '@/app/lib/schedule-drag-core'
import type { SchedulePostRow } from './useSchedulePosts'

/** What a post tile carries when it is dragged. Different from the rail's
 *  type on purpose: dropping a POST and dropping a piece of MEDIA mean two
 *  different things, and a column has to be able to tell them apart. */
export const TILE_DRAG_TYPE = 'application/x-md-post'

/** Every tile carries its post id in the DOM, so a move that lands in another
 *  column can put the keyboard back on it after React has rebuilt the grid. */
export const POST_ID_ATTR = 'data-post-id'

/** Where a point on the screen is, in calendar terms. The week grid and the
 *  month grid each register one of these while they are on screen. */
export type SlotResolver = (clientX: number, clientY: number) => string | null

export type MoveMode = 'mouse' | 'touch' | 'keyboard'

export type MovingTile = {
  postId: string
  title: string
  /** where it was before anybody touched it — where it snaps back to */
  from: string | null
  /** where it would land if it were let go now */
  to: string | null
  mode: MoveMode
}

export type MoveResult = { ok: boolean; error?: string }

/** A finger that has come down on a tile but has not held still long enough
 *  to lift it. It is a scroll until proven otherwise. */
type Press = { postId: string; x: number; y: number }

/** How far a finger may wander during the long press before it is obviously
 *  a scroll and not a press. */
const PRESS_SLOP_PX = 10

/** A move nobody answered. The listener is the truth; a drawn time with no
 *  answer behind it must not outlive a slow request. */
const SAFETY_MS = 10_000

export type DragSchedule = {
  moving: MovingTile | null
  /** posts whose move is with the server right now — drawn dimmed */
  saving: ReadonlySet<string>
  /** where a moved post is shown until its live row catches up */
  optimistic: Readonly<Record<string, string>>
  /** the server's sentence when a move was refused */
  message: string | null
  /** what a screen reader is told, live */
  announcement: string
  dismiss(): void
  /** stop overriding the listener for the posts that have caught up */
  settle(posts: readonly SettlablePost[]): void
  registerResolver(fn: SlotResolver | null): () => void
  /** a tile was dragged over a time — highlight it and say what dropping does */
  hoverAt(iso: string | null): void
  /** a tile was dropped on a time */
  dropAt(iso: string | null): void
  /** the drag ended without a drop */
  cancel(): void
  startMouse(post: SchedulePostRow, dataTransfer: DataTransfer): boolean
  startTouch(post: SchedulePostRow, point: { x: number; y: number }): void
  endTouchIntent(): void
  onTileKeyDown(post: SchedulePostRow, e: React.KeyboardEvent): void
  /** may this one be picked up (and the plain reason it may not) */
  blockedReason(post: SchedulePostRow): string | null
  /**
   * Did a finger just finish a move here?
   *
   * A touch drag ends with a `pointerup`, and the browser follows it with a
   * `click` on whatever is underneath — which would open the composer on the
   * post that was just dropped, or start a new one on the slot it landed in.
   * The tile and the column both ask this before acting on a click.
   */
  recentlyMoved(): boolean
}

export function useDragSchedule({ tz, onMove, hours = GRID_HOURS }: {
  /** the client's zone — every time a drag produces is in it */
  tz: string
  /** save the move; the message on a refusal is the SERVER's */
  onMove: (postId: string, iso: string) => Promise<MoveResult>
  /** the hours the grid draws, so a keyboard move cannot leave the picture */
  hours?: HourWindow
}): DragSchedule {
  const [moving, setMoving] = useState<MovingTile | null>(null)
  const [state, setState] = useState<MoveState>(NO_MOVES)
  const [press, setPress] = useState<Press | null>(null)

  const resolver = useRef<SlotResolver | null>(null)
  const movingRef = useRef<MovingTile | null>(null)
  const longPress = useRef<number | null>(null)
  const finishedAt = useRef(0)

  // held in an effect, not written during render: a render React throws away
  // must not leave its half-finished state behind in a ref
  useEffect(() => { movingRef.current = moving }, [moving])

  const registerResolver = useCallback((fn: SlotResolver | null) => {
    resolver.current = fn
    return () => { if (resolver.current === fn) resolver.current = null }
  }, [])

  const dismiss = useCallback(() => setState(s => ({ ...s, message: null })), [])

  const settle = useCallback((posts: readonly SettlablePost[]) => {
    setState(s => {
      const done = settledIds(posts, s.optimistic)
      if (done.length === 0) return s
      const optimistic = { ...s.optimistic }
      for (const id of done) delete optimistic[id]
      return { ...s, optimistic }
    })
  }, [])

  const commit = useCallback(async (held: MovingTile, iso: string) => {
    setMoving(null)
    if (!shouldCommit(held.from, iso)) return
    // the tile lands where it was dropped straight away; the server gets to
    // take it back, and only the server
    setState(s => beginMove(s, { postId: held.postId, title: held.title, iso, tz }))

    // if the keyboard was on this tile, it has to be on it again afterwards:
    // a move across a day unmounts the button and focus would fall to the body
    const hadFocus = typeof document !== 'undefined'
      && document.activeElement?.getAttribute(POST_ID_ATTR) === held.postId

    // nothing may leave a drawn time behind it, including a request that
    // never comes back
    const safety = window.setTimeout(() => {
      setState(s => finishMove(s, { postId: held.postId, title: held.title, ok: true }))
    }, SAFETY_MS)

    let result: MoveResult
    try {
      result = await onMove(held.postId, iso)
    } catch {
      result = { ok: false, error: 'That move did not save. Check your connection and try again.' }
    }
    window.clearTimeout(safety)
    setState(s => finishMove(s, {
      postId: held.postId, title: held.title, ok: result.ok, error: result.error,
    }))

    if (hadFocus) {
      // after React has drawn the tile in its new column
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`[${POST_ID_ATTR}="${held.postId}"]`)
        el?.focus()
      }))
    }
  }, [onMove, tz])

  const hoverAt = useCallback((iso: string | null) => {
    setMoving(prev => (prev && prev.to !== iso ? { ...prev, to: iso } : prev))
  }, [])

  const endTouchIntent = useCallback(() => {
    if (longPress.current !== null) {
      window.clearTimeout(longPress.current)
      longPress.current = null
    }
    setPress(null)
  }, [])

  const cancel = useCallback(() => {
    endTouchIntent()
    const held = movingRef.current
    if (held) setState(s => ({ ...s, announcement: `${held.title} stayed where it was` }))
    setMoving(null)
  }, [endTouchIntent])

  const dropAt = useCallback((iso: string | null) => {
    const held = movingRef.current
    if (!held) return
    if (held.mode === 'touch') finishedAt.current = Date.now()
    if (!iso) { cancel(); return }
    void commit(held, iso)
  }, [cancel, commit])

  const blockedReason = useCallback(
    (post: SchedulePostRow) => dragBlockReason({ status: post.live_status }), [])

  const lift = useCallback((post: SchedulePostRow, mode: MoveMode) => {
    setMoving({
      postId: post.id,
      title: post.item_title ?? 'Post',
      from: post.scheduled_for ?? null,
      to: post.scheduled_for ?? null,
      mode,
    })
  }, [])

  const startMouse = useCallback((post: SchedulePostRow, dataTransfer: DataTransfer) => {
    const stop = dragBlockReason({ status: post.live_status })
    if (stop) { setState(s => ({ ...s, message: stop })); return false }
    try {
      dataTransfer.setData(TILE_DRAG_TYPE, post.id)
      dataTransfer.effectAllowed = 'move'
    } catch { /* a browser that will not carry the payload still drags */ }
    setState(s => ({ ...s, message: null }))
    lift(post, 'mouse')
    return true
  }, [lift])

  /** a finger has come down on a tile: lift it if it stays put long enough */
  const startTouch = useCallback((post: SchedulePostRow, point: { x: number; y: number }) => {
    if (dragBlockReason({ status: post.live_status })) return
    if (longPress.current !== null) window.clearTimeout(longPress.current)
    setPress({ postId: post.id, x: point.x, y: point.y })
    longPress.current = window.setTimeout(() => {
      longPress.current = null
      setPress(null)
      setState(s => ({
        ...s,
        message: null,
        announcement: movingAnnouncement(post.item_title, post.scheduled_for, tz),
      }))
      lift(post, 'touch')
    }, LONG_PRESS_MS)
  }, [lift, tz])

  const onTileKeyDown = useCallback((post: SchedulePostRow, e: React.KeyboardEvent) => {
    const held = movingRef.current
    const mine = held && held.postId === post.id && held.mode === 'keyboard'

    if (!mine) {
      // Enter on a tile that is NOT being moved still opens it — only Space
      // picks a post up cold, so the common action keeps the common key
      if (e.key !== ' ') return
      const stop = dragBlockReason({ status: post.live_status })
      e.preventDefault()
      if (stop) { setState(s => ({ ...s, message: stop })); return }
      setState(s => ({
        ...s,
        message: null,
        announcement: movingAnnouncement(post.item_title, post.scheduled_for, tz),
      }))
      lift(post, 'keyboard')
      return
    }

    if (e.key === 'Escape') { e.preventDefault(); cancel(); return }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (held.to) void commit(held, held.to)
      else cancel()
      return
    }
    const next = keyboardMove(held.to ?? held.from, e.key, tz, hours)
    if (!next) return
    e.preventDefault()
    setMoving({ ...held, to: next })
    setState(s => ({ ...s, announcement: movingAnnouncement(held.title, next, tz) }))
  }, [cancel, commit, hours, lift, tz])

  /* A press waiting to become a lift. Anything else the finger does — moving
     more than a few pixels, the page scrolling under it, letting go — means
     it was a scroll or a tap, and the press is abandoned. Nothing here
     prevents the scroll: the week has to stay scrollable everywhere, tiles
     included. */
  useEffect(() => {
    if (!press) return
    const far = (x: number, y: number) =>
      Math.abs(x - press.x) > PRESS_SLOP_PX || Math.abs(y - press.y) > PRESS_SLOP_PX
    const onMoveEvent = (e: PointerEvent) => { if (far(e.clientX, e.clientY)) endTouchIntent() }
    const onScroll = () => endTouchIntent()
    window.addEventListener('pointermove', onMoveEvent, { passive: true })
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      window.removeEventListener('pointermove', onMoveEvent)
      window.removeEventListener('scroll', onScroll, { capture: true })
    }
  }, [press, endTouchIntent])

  /* The finger, while a tile is lifted: the page itself has to follow it,
     because the pointer is nowhere near the tile's own element any more. The
     non-passive `touchmove` is what stops the week scrolling under a post
     somebody is carrying — `touch-action` cannot do it, because a browser
     will not honour a change to it in the middle of a gesture. */
  useEffect(() => {
    if (!moving || moving.mode !== 'touch') return
    const onPointerMove = (e: PointerEvent) => {
      const iso = resolver.current?.(e.clientX, e.clientY) ?? null
      setMoving(prev => (prev ? { ...prev, to: iso ?? prev.to } : prev))
    }
    const hold = (e: TouchEvent) => { if (e.cancelable) e.preventDefault() }
    const onPointerUp = (e: PointerEvent) => {
      const iso = resolver.current?.(e.clientX, e.clientY) ?? movingRef.current?.to ?? null
      dropAt(iso)
    }
    const onCancel = () => cancel()
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('touchmove', hold, { passive: false })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('touchmove', hold)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }, [moving, dropAt, cancel])

  /* a drag that ends anywhere but a column — over the rail, off the window —
     is a cancel, not a silent tile stuck mid-air */
  useEffect(() => {
    if (!moving || moving.mode !== 'mouse') return
    const onDragEnd = () => setMoving(null)
    window.addEventListener('dragend', onDragEnd)
    return () => window.removeEventListener('dragend', onDragEnd)
  }, [moving])

  useEffect(() => () => {
    if (longPress.current !== null) window.clearTimeout(longPress.current)
  }, [])

  const saving = useMemo(() => new Set(state.saving), [state.saving])

  // the rule itself is pure and tested next door — this only supplies the
  // clock and the moment the last finger drag ended
  const recentlyMoved = useCallback(
    () => isRecentlyMoved(finishedAt.current, Date.now()), [])

  return {
    moving,
    saving,
    optimistic: state.optimistic,
    message: state.message,
    announcement: state.announcement,
    dismiss, settle, registerResolver, hoverAt, dropAt, cancel,
    startMouse, startTouch, endTouchIntent, onTileKeyDown, blockedReason,
    recentlyMoved,
  }
}
