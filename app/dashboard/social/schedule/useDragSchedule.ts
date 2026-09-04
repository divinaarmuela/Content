'use client'

/**
 * PICKING A POST UP AND PUTTING IT DOWN SOMEWHERE ELSE.
 *
 * Three ways, because a calendar you can only use with a mouse is a calendar
 * half the team cannot use:
 *
 *   MOUSE     native drag events, the same ones the media rail already uses,
 *             so a tile and a rail card behave identically.
 *   TOUCH     a long press lifts the tile (a short press still scrolls the
 *             week), then the finger drags it.
 *   KEYBOARD  focus a tile, Space or Enter picks it up, the arrows move it by
 *             half an hour or a day, Enter puts it down, Escape puts it back.
 *
 * All three end in the same place: `commit()`. The move shows IMMEDIATELY —
 * the tile is where you dropped it before the server has answered, because a
 * tile that hangs where it was for half a second reads as "it did not work"
 * and gets dragged again. If the server refuses, the tile snaps back to where
 * it started and the server's own sentence is shown. It is never rewritten
 * here: the reason a post could not move is the server's to give.
 *
 * The rules themselves — snapping, the keyboard step, the label, whether a
 * tile may lift at all — are `schedule-drag-core`, pure and tested. This file
 * is the hands.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  dragBlockReason, keyboardMove, LONG_PRESS_MS, movedAnnouncement, movingAnnouncement,
} from '@/app/lib/schedule-drag-core'
import type { SchedulePostRow } from './useSchedulePosts'

/** What a post tile carries when it is dragged. Different from the rail's
 *  type on purpose: dropping a POST and dropping a piece of MEDIA mean two
 *  different things, and a column has to be able to tell them apart. */
export const TILE_DRAG_TYPE = 'application/x-md-post'

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
  /** the finger, for the label that follows it */
  point: { x: number; y: number } | null
}

export type MoveResult = { ok: boolean; error?: string }

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
  settled(ids: readonly string[]): void
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

export function useDragSchedule({ tz, onMove }: {
  /** the client's zone — every time a drag produces is in it */
  tz: string
  /** save the move; the message on a refusal is the SERVER's */
  onMove: (postId: string, iso: string) => Promise<MoveResult>
}): DragSchedule {
  const [moving, setMoving] = useState<MovingTile | null>(null)
  const [saving, setSaving] = useState<Set<string>>(() => new Set())
  const [optimistic, setOptimistic] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const resolver = useRef<SlotResolver | null>(null)
  const movingRef = useRef<MovingTile | null>(null)
  movingRef.current = moving
  const longPress = useRef<number | null>(null)
  const finishedAt = useRef(0)

  const registerResolver = useCallback((fn: SlotResolver | null) => {
    resolver.current = fn
    return () => { if (resolver.current === fn) resolver.current = null }
  }, [])

  const dismiss = useCallback(() => setMessage(null), [])

  const settled = useCallback((ids: readonly string[]) => {
    if (ids.length === 0) return
    setOptimistic(prev => {
      const next = { ...prev }
      for (const id of ids) delete next[id]
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
  }, [])

  const commit = useCallback(async (post: MovingTile, iso: string) => {
    setMoving(null)
    if (iso === post.from) return
    // the tile lands where it was dropped straight away; the server gets to
    // take it back, and only the server
    setOptimistic(prev => ({ ...prev, [post.postId]: iso }))
    setSaving(prev => new Set(prev).add(post.postId))
    setAnnouncement(movedAnnouncement(post.title, iso, tz))
    let result: MoveResult
    try {
      result = await onMove(post.postId, iso)
    } catch {
      result = { ok: false, error: 'That move did not save. Check your connection and try again.' }
    }
    setSaving(prev => {
      const next = new Set(prev)
      next.delete(post.postId)
      return next
    })
    if (!result.ok) {
      setOptimistic(prev => {
        const next = { ...prev }
        delete next[post.postId]
        return next
      })
      const why = result.error ?? 'That move did not save. Try again.'
      setMessage(why)
      setAnnouncement(`${post.title} stayed where it was. ${why}`)
    }
  }, [onMove, tz])

  const hoverAt = useCallback((iso: string | null) => {
    setMoving(prev => (prev && prev.to !== iso ? { ...prev, to: iso } : prev))
  }, [])

  const cancel = useCallback(() => {
    if (longPress.current !== null) {
      window.clearTimeout(longPress.current)
      longPress.current = null
    }
    const held = movingRef.current
    if (held) setAnnouncement(`${held.title} stayed where it was`)
    setMoving(null)
  }, [])

  const dropAt = useCallback((iso: string | null) => {
    const held = movingRef.current
    if (!held) return
    if (held.mode === 'touch') finishedAt.current = Date.now()
    if (!iso) { cancel(); return }
    void commit(held, iso)
  }, [cancel, commit])

  const blockedReason = useCallback(
    (post: SchedulePostRow) => dragBlockReason({ status: post.live_status }), [])

  const startMouse = useCallback((post: SchedulePostRow, dataTransfer: DataTransfer) => {
    const stop = dragBlockReason({ status: post.live_status })
    if (stop) { setMessage(stop); return false }
    try {
      dataTransfer.setData(TILE_DRAG_TYPE, post.id)
      dataTransfer.effectAllowed = 'move'
    } catch { /* a browser that will not carry the payload still drags */ }
    setMessage(null)
    setMoving({
      postId: post.id,
      title: post.item_title ?? 'Post',
      from: post.scheduled_for ?? null,
      to: post.scheduled_for ?? null,
      mode: 'mouse',
      point: null,
    })
    return true
  }, [])

  /** a finger has come down on a tile: lift it if it stays put long enough */
  const startTouch = useCallback((post: SchedulePostRow, point: { x: number; y: number }) => {
    const stop = dragBlockReason({ status: post.live_status })
    if (stop) return
    if (longPress.current !== null) window.clearTimeout(longPress.current)
    longPress.current = window.setTimeout(() => {
      longPress.current = null
      setMessage(null)
      setMoving({
        postId: post.id,
        title: post.item_title ?? 'Post',
        from: post.scheduled_for ?? null,
        to: post.scheduled_for ?? null,
        mode: 'touch',
        point,
      })
      setAnnouncement(movingAnnouncement(post.item_title, post.scheduled_for, tz))
    }, LONG_PRESS_MS)
  }, [tz])

  /** the finger left before the press was long enough — it was a tap */
  const endTouchIntent = useCallback(() => {
    if (longPress.current !== null) {
      window.clearTimeout(longPress.current)
      longPress.current = null
    }
  }, [])

  const onTileKeyDown = useCallback((post: SchedulePostRow, e: React.KeyboardEvent) => {
    const held = movingRef.current
    const mine = held && held.postId === post.id && held.mode === 'keyboard'

    if (!mine) {
      if (e.key !== ' ' && e.key !== 'Enter') return
      // Enter on a tile that is NOT being moved still opens it — only Space
      // picks a post up cold, so the common action keeps the common key
      if (e.key === 'Enter') return
      const stop = dragBlockReason({ status: post.live_status })
      if (stop) { e.preventDefault(); setMessage(stop); return }
      e.preventDefault()
      setMessage(null)
      setMoving({
        postId: post.id,
        title: post.item_title ?? 'Post',
        from: post.scheduled_for ?? null,
        to: post.scheduled_for ?? null,
        mode: 'keyboard',
        point: null,
      })
      setAnnouncement(movingAnnouncement(post.item_title, post.scheduled_for, tz))
      return
    }

    if (e.key === 'Escape') { e.preventDefault(); cancel(); return }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (held.to) void commit(held, held.to)
      else cancel()
      return
    }
    const next = keyboardMove(held.to ?? held.from, e.key, tz)
    if (!next) return
    e.preventDefault()
    setMoving({ ...held, to: next })
    setAnnouncement(movingAnnouncement(held.title, next, tz))
  }, [cancel, commit, tz])

  /* the finger, while a tile is lifted: the page itself has to follow it,
     because the pointer is nowhere near the tile's own element any more */
  useEffect(() => {
    if (!moving || moving.mode !== 'touch') return
    const onPointerMove = (e: PointerEvent) => {
      e.preventDefault()
      const iso = resolver.current?.(e.clientX, e.clientY) ?? null
      setMoving(prev => (prev ? { ...prev, to: iso ?? prev.to, point: { x: e.clientX, y: e.clientY } } : prev))
    }
    const onPointerUp = (e: PointerEvent) => {
      const iso = resolver.current?.(e.clientX, e.clientY) ?? movingRef.current?.to ?? null
      dropAt(iso)
    }
    const onCancel = () => cancel()
    window.addEventListener('pointermove', onPointerMove, { passive: false })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
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

  const recentlyMoved = useCallback(() => Date.now() - finishedAt.current < 500, [])

  return {
    moving, saving, optimistic, message, announcement,
    dismiss, settled, registerResolver, hoverAt, dropAt, cancel,
    startMouse, startTouch, endTouchIntent, onTileKeyDown, blockedReason,
    recentlyMoved,
  }
}
