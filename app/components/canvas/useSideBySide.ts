'use client'

import { useEffect, useRef, useState } from 'react'

/** the room for board and panel together before a card's comments may sit beside the board rather than under it —
 *  the 340px panel leaves the board 520px or more */
export const SIDE_BY_SIDE_MIN = 880

/**
 * BESIDE THE BOARD ONLY WHERE THERE IS ROOM FOR BOTH (30 Oct 2026). Read off the space the board is given, not the
 * screen: on the team's shoot page the board sits in one column of two, and a screen-wide `lg:` rule put a 340px
 * panel beside a 360px board — the board shrank to a sliver behind it. True when the element is wide enough.
 */
export function useSideBySide<T extends HTMLElement>(min = SIDE_BY_SIDE_MIN) {
  const ref = useRef<T>(null)
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => setWide(el.getBoundingClientRect().width >= min)
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [min])
  return { ref, wide }
}
