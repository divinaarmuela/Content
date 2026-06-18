'use client'

import { useState } from 'react'
import { toast } from 'sonner'

type Status = 'live' | 'scheduled' | 'approved' | 'draft'
interface Post { title: string; client: string; status: Status }

const POSTS: Record<number, Post[]> = {
  2:  [{ title: 'Apex — Reel',         client: 'AF', status: 'live' }],
  3:  [{ title: 'Bloom — Carousel',    client: 'BS', status: 'live' }],
  5:  [{ title: 'Vertex — Post',       client: 'VL', status: 'live' }],
  8:  [{ title: 'Surge — Reel',        client: 'SC', status: 'live' }],
  9:  [{ title: 'Bloom — Story',       client: 'BS', status: 'live' }, { title: 'Align — Post', client: 'AW', status: 'live' }],
  10: [{ title: 'Apex — Ad',           client: 'AF', status: 'approved' }],
  12: [{ title: 'Nova — Carousel',     client: 'NB', status: 'approved' }],
  14: [{ title: 'Surge — Campaign',    client: 'SC', status: 'scheduled' }],
  15: [{ title: 'Apex — Reel series',  client: 'AF', status: 'scheduled' }, { title: 'Vertex — LI', client: 'VL', status: 'approved' }],
  16: [{ title: 'Bloom — Summer',      client: 'BS', status: 'scheduled' }],
  17: [{ title: 'Align — Draft',       client: 'AW', status: 'draft' }],
  18: [{ title: 'Nova — Launch',       client: 'NB', status: 'scheduled' }],
  20: [{ title: 'Surge — Menu',        client: 'SC', status: 'scheduled' }],
  22: [{ title: 'Align — Ep3',         client: 'AW', status: 'scheduled' }],
  24: [{ title: 'Apex — Paid ad',      client: 'AF', status: 'draft' }],
  27: [{ title: 'Bloom — Post',        client: 'BS', status: 'draft' }],
  30: [{ title: 'EOM recap',           client: 'VL', status: 'draft' }],
}

const DAYS  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const FILTERS: { label: string; value: Status }[] = [
  { label: 'Live',      value: 'live'      },
  { label: 'Scheduled', value: 'scheduled' },
  { label: 'Approved',  value: 'approved'  },
  { label: 'Draft',     value: 'draft'     },
]

export default function CalendarPage() {
  const [activeFilters, setActiveFilters] = useState<Status[]>([])
  const today = 17 // June 17
  const year = 2026, month = 5
  const firstDay   = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const toggle = (s: Status) =>
    setActiveFilters(f => f.includes(s) ? f.filter(x => x !== s) : [...f, s])

  const visible = (day: number) => {
    const posts = POSTS[day] ?? []
    return activeFilters.length === 0 ? posts : posts.filter(p => activeFilters.includes(p.status))
  }

  const upcoming = Object.entries(POSTS)
    .filter(([d]) => Number(d) >= today)
    .sort(([a], [b]) => Number(a) - Number(b))
    .slice(0, 8)

  return (
    <div className="db-page" style={{ maxWidth: '100%' }}>
      <div className="db-page-header">
        <div>
          <h1 className="db-page-title">Publishing Calendar</h1>
          <p className="db-page-sub">June 2026</p>
        </div>
        <div className="db-page-actions">
          <button className="db-btn db-btn-primary" onClick={() => toast.success('Post scheduled', { description: 'Publishing queue updated.' })}>+ Schedule post</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Calendar */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="db-cal-header">
            <div className="db-cal-nav">
              <button>‹</button>
              <span className="db-cal-month">June 2026</span>
              <button>›</button>
            </div>
            <div className="db-cal-filters">
              {FILTERS.map(f => (
                <button
                  key={f.value}
                  onClick={() => toggle(f.value)}
                  className={`db-cal-filter${activeFilters.includes(f.value) ? ' active' : ''}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="db-cal-grid">
            {DAYS.map(d => <div key={d} className="db-cal-day-name">{d}</div>)}
            {cells.map((day, i) => (
              <div
                key={i}
                className={`db-cal-cell${!day ? ' other-month' : ''}${day === today ? ' today' : ''}`}
              >
                {day && (
                  <>
                    <div className="db-cal-date">{day}</div>
                    {visible(day).map((p, j) => (
                      <div key={j} className={`db-cal-pill ${p.status}`}>{p.title}</div>
                    ))}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Upcoming sidebar */}
        <div style={{ width: 210, flexShrink: 0 }}>
          <div className="db-card" style={{ position: 'sticky', top: 20 }}>
            <div className="db-card-head">
              <span className="db-card-title">Upcoming</span>
            </div>
            <div style={{ padding: '10px 14px' }}>
              {upcoming.map(([day, posts]) => (
                <div key={day} style={{ marginBottom: 14 }}>
                  <p style={{ fontSize: 11, color: '#a8a5bb', fontWeight: 600, marginBottom: 5, letterSpacing: '0.03em' }}>
                    Jun {day}
                  </p>
                  {posts.map((p, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span className={`db-cal-pill ${p.status}`} style={{ margin: 0, flexShrink: 0 }}>{p.client}</span>
                      <span style={{ fontSize: 11, color: '#7b7990', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.title.split('—')[1]?.trim()}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
