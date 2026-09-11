'use client'

import { useCallback, useEffect, useState } from 'react'
import { NO_FILTERS, type Filters } from '../../lib/people-filter-core'

/**
 * The Client and People choice on a board — remembered per page, and in the
 * address so a link can be shared ("look at Ada's cards": `?person=<id>`).
 *
 * The address wins over the memory on arrival, the way `usePersistedChoice`
 * treats `?view=`; a change writes both. Read in an effect because these
 * pages prerender. The ids are validated against the rows on offer by the
 * page (`validChoice`), never here — this only remembers.
 */
export function useBoardFilters(pageKey: string): Filters & {
  setClient: (id: string | null) => void
  setPerson: (id: string | null) => void
  clear: () => void
} {
  const [value, setValue] = useState<Filters>(NO_FILTERS)
  const storage = (k: keyof Filters) => `md-board-filter.${pageKey}.${k}`

  useEffect(() => {
    const read = (k: keyof Filters): string | null => {
      let fromUrl: string | null = null
      let fromStorage: string | null = null
      try { fromUrl = new URLSearchParams(window.location.search).get(k) } catch { /* no address */ }
      try { fromStorage = localStorage.getItem(storage(k)) } catch { /* blocked storage */ }
      return fromUrl || fromStorage || null
    }
    setValue({ client: read('client'), person: read('person') })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey])

  const write = useCallback((k: keyof Filters, id: string | null) => {
    setValue(v => ({ ...v, [k]: id }))
    try { if (id) localStorage.setItem(storage(k), id); else localStorage.removeItem(storage(k)) } catch { /* private mode */ }
    try {
      const url = new URL(window.location.href)
      if (id) url.searchParams.set(k, id); else url.searchParams.delete(k)
      window.history.replaceState(null, '', url.toString())
    } catch { /* the page still filters */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey])

  return {
    ...value,
    setClient: useCallback((id: string | null) => write('client', id), [write]),
    setPerson: useCallback((id: string | null) => write('person', id), [write]),
    clear: useCallback(() => { write('client', null); write('person', null) }, [write]),
  }
}
