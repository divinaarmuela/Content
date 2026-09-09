/**
 * WHEN THE CLEAN COPIES WILL BE READY — the pure half.
 *
 * A booked time is a promise. The copies a post needs are made by the
 * encoder after the file is attached, and a 4K master at the slow preset
 * takes real minutes (measured 10 Sep 2026: a 108-second 1080p copy took
 * about 5 minutes; 4K is several times that). A post booked for 1:15 with
 * copies still running at 1:15 goes out late, or — worse — nobody knows
 * which. So the window and the server both ask this file: given the
 * encoder's rows for this clip, when will every copy this post needs be
 * done? Then the earliest safe time is a little after that.
 */

import { MIN_LEAD_MS } from './social-schedule-core'

export type EncodeRowEta = {
  platform?: string | null
  status?: string | null
  created_at?: string | null
  /** the clip's length, when the row knows it */
  duration_sec?: number | null
  /** the master's size, when probed — 4K takes far longer */
  width?: number | null
  height?: number | null
}

/** seconds of encoding per second of clip, by picture size — measured, then
 *  rounded up so the promise is kept more often than not */
export const ENCODE_FACTOR_1080 = 3.5
export const ENCODE_FACTOR_4K = 10
/** download + upload + the callback, per copy */
const PER_COPY_OVERHEAD_MS = 60_000
/** the encoder waits this long between finishing and reporting, worst case */
const SAFETY_MS = 2 * 60_000
/** a clip nobody has measured is budgeted as two minutes long */
const ASSUMED_SECONDS = 120

function factorFor(row: EncodeRowEta): number {
  const long = Math.max(row.width ?? 0, row.height ?? 0)
  return long >= 3000 ? ENCODE_FACTOR_4K : ENCODE_FACTOR_1080
}

/**
 * When the last of these copies will be done, or null when none is still
 * being made. Copies of one file run one after another on the encoder, in
 * the order they were asked for, so each waits for the ones before it.
 */
export function copiesReadyAt(
  rows: readonly EncodeRowEta[],
  platforms: readonly string[],
  now: number,
  seconds?: number | null,
): number | null {
  const wanted = new Set(platforms.map(p => String(p).toLowerCase()))
  const open = rows
    .filter(r => r && wanted.has(String(r.platform ?? '').toLowerCase()))
    .filter(r => r.status === 'queued' || r.status === 'running')
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
  if (open.length === 0) return null
  let clock = now
  let latest = now
  for (const r of open) {
    const started = Date.parse(String(r.created_at ?? '')) || now
    const clip = r.duration_sec ?? seconds ?? ASSUMED_SECONDS
    const work = clip * factorFor(r) * 1000 + PER_COPY_OVERHEAD_MS
    // a copy already running started when it was asked; one still queued
    // starts when the encoder is free — at its ask, or after the one before
    const begins = r.status === 'running' ? started : Math.max(started, clock)
    clock = begins + work
    latest = Math.max(latest, clock)
  }
  return latest + SAFETY_MS
}

/** The earliest time a post may be booked for: the ordinary 15-minute lead,
 *  or the copies' finish, whichever is later. */
export function earliestSafeTime(now: number, readyAt: number | null): number {
  return Math.max(now + MIN_LEAD_MS, readyAt ?? 0)
}

/** "The copies for TikTok and Instagram will be ready by about 1:25 am — the
 *  earliest safe time is 1:27 am." — one sentence, in the client's clock. */
export function copiesLateWords(
  platformLabels: readonly string[],
  readyAt: number,
  safeAt: number,
  fmt: (ms: number) => string,
): string {
  const names = platformLabels.length <= 1
    ? platformLabels[0] ?? 'the channels'
    : `${platformLabels.slice(0, -1).join(', ')} and ${platformLabels[platformLabels.length - 1]}`
  return `The clean copies for ${names} will be ready by about ${fmt(readyAt)} — the earliest safe time is ${fmt(safeAt)}. Pick a time after that, or wait for the copies.`
}
