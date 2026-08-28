'use client'

import { useCallback, useRef } from 'react'
import { LoadOrder } from '../lib/load-order'

/**
 * One refetch for a page, with the answers kept in order — and never lost.
 *
 * `fetcher` does the reading and returns everything the page needs in one
 * value; `apply` writes it into state. Splitting them that way is what makes
 * the ordering decidable at all: with the setState calls buried inside the
 * fetch, a "discarded" answer had already half-applied itself.
 *
 * The returned `load` resolves only once its answer has been applied or
 * superseded, so a mutation can `await load()` and know the screen has caught
 * up before it stops showing a spinner.
 *
 * Overlapping calls are COALESCED, not multiplied: a load() issued while one
 * is already in flight does not open a second fetch — it books ONE trailing
 * refetch that starts after the in-flight one settles, and every further
 * call made in the meantime shares it. The trailing fetch begins after each
 * of those requests was made, so nothing it answers can be staler than what
 * the caller asked about — and a mutation-then-realtime-hint pair costs two
 * requests instead of N. Freshness is preserved; duplicates are not sent.
 *
 * See `lib/load-order.ts` for why "newest issued wins" was not good enough.
 */
export function useOrderedLoad<T>(
  fetcher: () => Promise<T>,
  apply: (value: T) => void,
): () => Promise<void> {
  const order = useRef<LoadOrder<T> | null>(null)
  order.current ??= new LoadOrder<T>()
  // read through a ref so a caller need not memoise `apply` to keep `load`
  // stable — an unstable load() refetches on every render
  const applyRef = useRef(apply)
  applyRef.current = apply
  const fetchRef = useRef(fetcher)
  fetchRef.current = fetcher
  /** the fetch currently on the wire, if any */
  const inFlight = useRef<Promise<void> | null>(null)
  /** the one refetch booked to run after it, shared by every caller waiting */
  const trailing = useRef<Promise<void> | null>(null)

  const run = useCallback(async () => {
    const seq = order.current!.begin()
    let settled
    try {
      settled = order.current!.settle(seq, await fetchRef.current())
    } catch (e) {
      // a failed request must not strand a fresher answer that is waiting on it
      const released = order.current!.fail(seq)
      if (released.apply) applyRef.current(released.value)
      throw e
    }
    if (settled.apply) applyRef.current(settled.value)
  }, [])

  const load = useCallback((): Promise<void> => {
    if (inFlight.current) {
      // one trailing refetch serves every request made while this one flies;
      // it starts AFTER the in-flight answer, so it is fresh for all of them
      trailing.current ??= inFlight.current
        .catch(() => { /* the first flight's failure is its own callers' news */ })
        .then(() => {
          trailing.current = null
          return load()
        })
      return trailing.current
    }
    const flight = run().finally(() => {
      if (inFlight.current === flight) inFlight.current = null
    })
    inFlight.current = flight
    return flight
  }, [run])

  return load
}
