'use client'

import { useState } from 'react'
import { toast } from 'sonner'

interface Commitment {
  type: string
  committed: number
  completed: number
  inProgress: number
}

interface Client {
  name: string
  contact: string
  retainer: string
  services: string[]
  status: 'active' | 'onboarding' | 'paused'
  color: string
  initials: string
  am: string
  commitments: Commitment[]
}

const CLIENTS: Client[] = [
  {
    name: 'Apex Fitness', contact: 'Ryan Mercer', retainer: '$4,200', am: 'AK',
    services: ['Social Media', 'Content', 'Ads'], status: 'active', color: '#f97316', initials: 'AF',
    commitments: [
      { type: 'Reels',     committed: 10, completed: 7, inProgress: 2 },
      { type: 'Carousels', committed: 4,  completed: 2, inProgress: 1 },
      { type: 'Stories',   committed: 8,  completed: 8, inProgress: 0 },
    ],
  },
  {
    name: 'Bloom Skincare', contact: 'Priya Nair', retainer: '$3,800', am: 'DV',
    services: ['Content', 'Ads'], status: 'active', color: '#ec4899', initials: 'BS',
    commitments: [
      { type: 'Reels',     committed: 8,  completed: 5, inProgress: 2 },
      { type: 'Carousels', committed: 4,  completed: 4, inProgress: 0 },
    ],
  },
  {
    name: 'Vertex Legal', contact: 'Tom Brennan', retainer: '$6,500', am: 'AK',
    services: ['Social Media', 'LinkedIn', 'Content'], status: 'active', color: '#8b5cf6', initials: 'VL',
    commitments: [
      { type: 'Carousels', committed: 6,  completed: 6, inProgress: 0 },
      { type: 'Reels',     committed: 4,  completed: 4, inProgress: 0 },
      { type: 'Statics',   committed: 8,  completed: 7, inProgress: 1 },
    ],
  },
  {
    name: 'NovaBuild Co.', contact: 'Sarah Lim', retainer: '$5,100', am: 'MW',
    services: ['Branding', 'Website', 'Content'], status: 'onboarding', color: '#2563eb', initials: 'NB',
    commitments: [
      { type: 'Reels',     committed: 10, completed: 0, inProgress: 4 },
      { type: 'Carousels', committed: 4,  completed: 0, inProgress: 2 },
    ],
  },
  {
    name: 'Surge Coffee', contact: 'Marcus Webb', retainer: '$2,900', am: 'JR',
    services: ['Social Media', 'Content'], status: 'active', color: '#d97706', initials: 'SC',
    commitments: [
      { type: 'Reels',     committed: 8,  completed: 7, inProgress: 1 },
      { type: 'Stories',   committed: 6,  completed: 5, inProgress: 0 },
    ],
  },
  {
    name: 'Align Wellness', contact: 'Dana Okafor', retainer: '$3,200', am: 'SL',
    services: ['Content', 'Ads'], status: 'active', color: '#16a34a', initials: 'AW',
    commitments: [
      { type: 'Reels',     committed: 10, completed: 6, inProgress: 3 },
      { type: 'Carousels', committed: 4,  completed: 2, inProgress: 1 },
    ],
  },
]

const ASSIGNEE_COLORS: Record<string, string> = { AK: '#5d5fef', DV: '#ec4899', MW: '#16a34a', JR: '#f97316', SL: '#8b5cf6' }
type Filter = 'all' | 'active' | 'onboarding' | 'paused'

export default function ClientsPage() {
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')

  const visible = CLIENTS.filter(c => {
    if (filter !== 'all' && c.status !== filter) return false
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="db-page">
      <div className="db-page-header">
        <div>
          <h1 className="db-page-title">Client Workspaces</h1>
          <p className="db-page-sub">{CLIENTS.length} clients · {CLIENTS.filter(c => c.status === 'active').length} active · June 2026</p>
        </div>
        <div className="db-page-actions">
          <button className="db-btn db-btn-primary" onClick={() => toast.success('New client', { description: 'Client workspace creation coming soon.' })}>+ New client</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search clients..."
          style={{
            background: '#fff', border: '1px solid #e8e7ef', borderRadius: 8,
            padding: '7px 12px', color: '#1f1b2e', fontSize: 13, outline: 'none', width: 200,
          }}
        />
        {(['all', 'active', 'onboarding', 'paused'] as Filter[]).map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`db-cal-filter${filter === f ? ' active' : ''}`} style={{ textTransform: 'capitalize' }}>{f}</button>
        ))}
      </div>

      <div className="db-client-grid">
        {visible.map(c => {
          const totalCommitted  = c.commitments.reduce((a, b) => a + b.committed,  0)
          const totalCompleted  = c.commitments.reduce((a, b) => a + b.completed,  0)
          const totalInProgress = c.commitments.reduce((a, b) => a + b.inProgress, 0)
          const pct = Math.round((totalCompleted / totalCommitted) * 100)

          return (
            <div key={c.name} className="db-client-card">
              {/* Header */}
              <div className="db-client-card-top">
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div className="db-avatar" style={{ background: c.color, width: 38, height: 38, borderRadius: 10, fontSize: 12 }}>
                    {c.initials}
                  </div>
                  <div>
                    <p className="db-client-name">{c.name}</p>
                    <p className="db-client-contact">{c.contact}</p>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <span className={`db-status-pill ${c.status}`}>{c.status}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 10, color: '#a8a5bb' }}>AM:</span>
                    <div className="db-mini-av" style={{ background: ASSIGNEE_COLORS[c.am] ?? '#7b7990' }}>{c.am}</div>
                  </div>
                </div>
              </div>

              {/* Retainer */}
              <div>
                <p className="db-client-retainer">{c.retainer}</p>
                <p className="db-client-retainer-label">per month · retainer</p>
              </div>

              {/* Monthly commitment progress */}
              <div style={{ background: '#f9f8fc', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#7b7990', letterSpacing: '0.04em', textTransform: 'uppercase' }}>June commitments</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: pct >= 80 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626' }}>{pct}%</span>
                </div>
                <div className="db-health-bar" style={{ marginBottom: 10 }}>
                  <div className="db-health-fill" style={{ width: `${pct}%`, background: pct >= 80 ? '#16a34a' : pct >= 50 ? '#f97316' : '#dc2626' }} />
                </div>
                {c.commitments.map(cm => {
                  const cmPct = Math.round((cm.completed / cm.committed) * 100)
                  const pending = cm.committed - cm.completed - cm.inProgress
                  return (
                    <div key={cm.type} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                      <span style={{ fontSize: 11, color: '#7b7990', width: 72, flexShrink: 0 }}>{cm.type}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', gap: 2, height: 6, borderRadius: 3, overflow: 'hidden', background: '#e8e7ef' }}>
                          <div style={{ width: `${cmPct}%`, background: c.color, transition: 'width 0.3s' }} />
                          {cm.inProgress > 0 && (
                            <div style={{ width: `${Math.round((cm.inProgress / cm.committed) * 100)}%`, background: `${c.color}55` }} />
                          )}
                        </div>
                      </div>
                      <span style={{ fontSize: 10, color: '#a8a5bb', fontFamily: 'monospace', width: 60, textAlign: 'right', flexShrink: 0 }}>
                        {cm.completed}/{cm.committed}
                        {pending > 0 && <span style={{ color: '#e8e7ef' }}> +{pending}</span>}
                      </span>
                    </div>
                  )
                })}
                <div style={{ display: 'flex', gap: 12, marginTop: 8, paddingTop: 8, borderTop: '1px solid #e8e7ef' }}>
                  <span style={{ fontSize: 10, color: '#16a34a', fontWeight: 600 }}>{totalCompleted} done</span>
                  <span style={{ fontSize: 10, color: '#f97316', fontWeight: 600 }}>{totalInProgress} in progress</span>
                  <span style={{ fontSize: 10, color: '#a8a5bb', fontWeight: 500 }}>
                    {totalCommitted - totalCompleted - totalInProgress} pending
                  </span>
                </div>
              </div>

              {/* Services */}
              <div className="db-service-tags">
                {c.services.map(s => <span key={s} className="db-service-tag">{s}</span>)}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="db-btn db-btn-outline"
                  style={{ flex: 1, justifyContent: 'center', fontSize: 11 }}
                  onClick={() => toast(`Opening ${c.name} workspace`)}
                >
                  View workspace
                </button>
                <button
                  className="db-btn db-btn-primary"
                  style={{ flex: 1, justifyContent: 'center', fontSize: 11 }}
                  onClick={() => toast.success('Report sent', { description: `Monthly report sent to ${c.contact}` })}
                >
                  Send report
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
