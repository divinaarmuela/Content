'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import styles from './about.module.css'

const MONO = 'var(--font-space-mono), monospace'
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif"
const ACCENT = '#FFFFFF'

const NOISE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`

type Member = {
  name: string
  role: string
  /** path under /public (e.g. '/team/divina.jpg'); tile shows a placeholder until set */
  img?: string
  objectPosition?: string
}

type Dept = { name: string; members: Member[] }

const DEPTS: Dept[] = [
  {
    name: 'Leadership',
    members: [
      { name: 'Divina', role: 'Co-Founder & Managing Director', img: '/team/divina.jpg', objectPosition: '50% 80%' },
      { name: 'Martin', role: 'Co-Founder & Chief Production Officer', img: '/team/martin.jpg' },
      { name: 'Abby', role: 'Head of Operations', img: '/team/abby.jpg' },
      { name: 'Yusuf', role: 'Head of Paid Media', img: '/team/yusuf.jpg' },
    ],
  },
  {
    name: 'Client Accounts',
    members: [
      { name: 'Manal', role: 'Senior Account Manager', img: '/team/manal.jpg' },
    ],
  },
  {
    name: 'Social & Content',
    members: [
      { name: 'Karly', role: 'Social Media Strategist', img: '/team/karly.jpg' },
      { name: 'Renee', role: 'Social Media Strategist', img: '/team/renee.jpg' },
      { name: 'Raven', role: 'Social Media Strategist', img: '/team/raven.jpg' },
    ],
  },
  {
    name: 'Brand & Technology',
    members: [
      { name: 'Daniela', role: 'Brand & Graphic Designer', img: '/team/daniela.jpg' },
      { name: 'Akmal', role: 'Technology & Systems Lead', img: '/team/akmal.jpg' },
    ],
  },
  {
    name: 'Production',
    members: [
      { name: 'Ryan', role: 'Video Editor & Cinematographer', img: '/team/ryan.jpg' },
      { name: 'Sebastian', role: 'Photographer & Cinematographer', img: '/team/sebastian.jpg' },
      { name: 'Sarina', role: 'Photographer & Cinematographer', img: '/team/sarina.jpg' },
    ],
  },
]

export default function AboutTeam() {
  const [open, setOpen] = useState(0)
  // Opening one department closes another that may sit above it; the collapse
  // changes the page height above the clicked header and the viewport jumps.
  // Remember where the clicked header was and restore it after the re-render.
  const clicked = useRef<{ el: HTMLButtonElement; top: number } | null>(null)

  const toggle = (i: number, isOpen: boolean, e: React.MouseEvent<HTMLButtonElement>) => {
    clicked.current = { el: e.currentTarget, top: e.currentTarget.getBoundingClientRect().top }
    setOpen(isOpen ? -1 : i)
  }

  useLayoutEffect(() => {
    const c = clicked.current
    if (!c) return
    clicked.current = null
    const delta = c.el.getBoundingClientRect().top - c.top
    if (delta === 0) return
    // Lenis (active on non-Mac platforms) re-asserts its own scroll position
    // every frame, so plain scrollBy gets overridden — go through it instead.
    const lenis = (window as { __lenis?: { scrollTo: (y: number, o?: { immediate?: boolean }) => void } }).__lenis
    if (lenis) lenis.scrollTo(window.scrollY + delta, { immediate: true })
    else window.scrollBy(0, delta)
  }, [open])

  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.28)' }}>
      {DEPTS.map((dept, i) => {
        const isOpen = open === i
        return (
          <div key={dept.name} style={{ borderBottom: '1px solid rgba(255,255,255,0.2)' }}>
            <button
              onClick={e => toggle(i, isOpen, e)}
              className={styles.deptBtn}
              aria-expanded={isOpen}
            >
              <span style={{ fontFamily: MONO, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{String(i + 1).padStart(2, '0')}</span>
              <span className={styles.deptName} style={{ fontFamily: SANS, color: isOpen ? '#FFFFFF' : 'rgba(255,255,255,0.5)' }}>{dept.name}</span>
              <span className={styles.deptMembers} style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.06em', color: 'rgba(255,255,255,0.42)', textAlign: 'right' }}>
                {dept.members.map(m => m.name).join(', ')}{' '}
                <span style={{ color: 'rgba(255,255,255,0.25)' }}>/ {String(dept.members.length).padStart(2, '0')}</span>
              </span>
              <span className={styles.deptPlus} style={{ fontFamily: SANS, color: ACCENT, transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)' }}>+</span>
            </button>

            {isOpen && (
              <div className={styles.cardGrid}>
                {dept.members.map((member, j) => (
                  <div key={member.name} className={styles.card} style={{ animationDelay: `${0.05 + j * 0.07}s` }}>
                    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 12, marginBottom: 14 }}>
                      {member.img ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={member.img} alt={`${member.name}, ${member.role}`} style={{ width: '100%', aspectRatio: '4 / 5', objectFit: 'cover', objectPosition: member.objectPosition, display: 'block' }} />
                      ) : (
                        <div aria-hidden="true" style={{ width: '100%', aspectRatio: '4 / 5', background: '#141414', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ fontFamily: MONO, fontSize: 'clamp(2rem, 4vw, 3rem)', color: 'rgba(255,255,255,0.18)' }}>{member.name[0]}</span>
                        </div>
                      )}
                      <div className={styles.cardGrain} style={{ backgroundImage: NOISE, animationDelay: `${0.05 + j * 0.07}s` }} />
                    </div>
                    <h4 style={{ fontFamily: SANS, fontWeight: 500, fontSize: '1.15rem', letterSpacing: '-0.01em', margin: '0 0 5px' }}>{member.name}</h4>
                    <p style={{ fontFamily: MONO, fontSize: 11, lineHeight: 1.5, color: ACCENT, margin: 0 }}>{member.role}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
