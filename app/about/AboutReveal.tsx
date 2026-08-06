'use client'

import { useEffect } from 'react'
import styles from './about.module.css'

/** Reveals .reveal blocks as they scroll into view, mirroring the comp's
 *  data-anim behaviour. Scoped to this page's CSS module, not globals. */
export default function AboutReveal() {
  useEffect(() => {
    const targets = document.querySelectorAll(`.${styles.reveal}`)
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add(styles.shown)
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.06, rootMargin: '0px 0px -40px 0px' },
    )
    targets.forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  return null
}
