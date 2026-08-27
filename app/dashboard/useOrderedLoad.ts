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

  return useCallback(async () => {
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
}
