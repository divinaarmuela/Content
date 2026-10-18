'use client'

import { useEffect, useMemo, useState } from 'react'

/**
 * A CELEBRATION when a task is completed (Asana's flying creatures, the owner
 * 18 Oct 2026). One creature crosses the screen and is gone in under two
 * seconds. Never shown to someone who asked for less motion, never in the way
 * of a click (pointer-events none), and switched off in the page's Options.
 */
const CREATURES = ['🦄', '🐋', '🦕', '🐙', '🦜', '🚀']

export default function Celebration({ run }: { run: boolean }) {
  const [show, setShow] = useState(run)
  const creature = useMemo(() => CREATURES[Math.floor(Math.random() * CREATURES.length)], [])
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  useEffect(() => {
    if (!run || reduced) return
    const t = setTimeout(() => setShow(false), 1900)
    return () => clearTimeout(t)
  }, [run, reduced])
  if (!run || !show || reduced) return null
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] overflow-hidden" data-todo-celebration>
      <span className="absolute bottom-[-80px] left-[-80px] text-[64px] [animation:todo-fly_1.8s_cubic-bezier(0.3,0.7,0.4,1)_forwards]">{creature}</span>
      <style>{'@keyframes todo-fly{0%{transform:translate(0,0) rotate(-10deg)}60%{transform:translate(60vw,-70vh) rotate(8deg)}100%{transform:translate(110vw,-110vh) rotate(16deg);opacity:.2}}'}</style>
    </div>
  )
}
