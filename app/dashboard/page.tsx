'use client'

import Link from 'next/link'
import { toast } from 'sonner'

const CLIENTS = [
  { name: 'Apex Fitness',   initials: 'AF', color: '#f97316', pct: 78 },
  { name: 'Bloom Skincare', initials: 'BS', color: '#ec4899', pct: 62 },
  { name: 'Vertex Legal',   initials: 'VL', color: '#8b5cf6', pct: 91 },
  { name: 'NovaBuild Co.',  initials: 'NB', color: '#2563eb', pct: 45 },
  { name: 'Surge Coffee',   initials: 'SC', color: '#d97706', pct: 83 },
  { name: 'Align Wellness', initials: 'AW', color: '#16a34a', pct: 57 },
]

const ACTIVITY = [
  { text: 'Apex Fitness — 3 reels approved by client',       time: '2 min ago',  bg: '#f0fdf4', icon: '✓', iconColor: '#16a34a' },
  { text: 'New lead submitted — Jake T. from PureFlow Co.',  time: '18 min ago', bg: '#eff6ff', icon: '→', iconColor: '#2563eb' },
  { text: 'Bloom Skincare — content brief uploaded',         time: '1 hr ago',   bg: '#fff7ed', icon: '↑', iconColor: '#f97316' },
  { text: 'Vertex Legal — campaign scheduled for Friday',    time: '3 hr ago',   bg: '#faf5ff', icon: '◷', iconColor: '#8b5cf6' },
  { text: 'NovaBuild Co. — onboarding call completed',       time: '5 hr ago',   bg: '#fffbeb', icon: '★', iconColor: '#d97706' },
  { text: 'Surge Coffee — monthly retainer invoice sent',    time: 'Yesterday',  bg: '#f0fdf4', icon: '$', iconColor: '#16a34a' },
]

const METRICS = [
  { label: 'Active Clients',    value: '8',  delta: '+1 this month', up: true,  iconBg: '#eeeefd', iconColor: '#5d5fef' },
  { label: 'Tasks Due Today',   value: '7',  delta: '3 overdue',     up: false, iconBg: '#fef2f2', iconColor: '#dc2626' },
  { label: 'Pending Approvals', value: '11', delta: '4 new today',   up: true,  iconBg: '#fffbeb', iconColor: '#d97706' },
  { label: 'Posts Scheduled',   value: '84', delta: 'next 30 days',  up: true,  iconBg: '#f0fdf4', iconColor: '#16a34a' },
]

export default function DashboardHome() {
  const today = new Date().toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <div className="db-page">
      <div className="db-page-header">
        <div>
          <h1 className="db-page-title">Good morning 👋</h1>
          <p className="db-page-sub">{today}</p>
        </div>
        <div className="db-page-actions">
          <Link href="/dashboard/leads" className="db-btn db-btn-outline">View leads →</Link>
          <button
            className="db-btn db-btn-primary"
            onClick={() => toast.success('Task created', { description: 'New task added to Brief column.' })}
          >
            + New task
          </button>
        </div>
      </div>

      {/* Metrics */}
      <div className="db-metrics">
        {METRICS.map(m => (
          <div key={m.label} className="db-metric-card">
            <div className="db-metric-icon" style={{ background: m.iconBg }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="5" stroke={m.iconColor} strokeWidth="1.5"/>
              </svg>
            </div>
            <p className="db-metric-label">{m.label}</p>
            <p className="db-metric-value">{m.value}</p>
            <p className={`db-metric-delta${m.up ? '' : ' down'}`}>
              {m.up ? '↑' : '↓'} {m.delta}
            </p>
          </div>
        ))}
      </div>

      {/* Two columns */}
      <div className="db-two-col">
        {/* Client health */}
        <div className="db-card">
          <div className="db-card-head">
            <span className="db-card-title">Client Health</span>
            <Link href="/dashboard/clients" className="db-card-link">View all</Link>
          </div>
          <div className="db-card-body">
            {CLIENTS.map(c => (
              <div key={c.name} className="db-health-row">
                <div className="db-avatar" style={{ background: c.color }}>{c.initials}</div>
                <div className="db-health-info">
                  <p className="db-health-name">{c.name}</p>
                  <div className="db-health-bar">
                    <div className="db-health-fill" style={{ width: `${c.pct}%`, background: c.color }} />
                  </div>
                </div>
                <span className="db-health-pct">{c.pct}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent activity */}
        <div className="db-card">
          <div className="db-card-head">
            <span className="db-card-title">Recent Activity</span>
            <span style={{ fontSize: 11, color: '#a8a5bb' }}>{ACTIVITY.length} events</span>
          </div>
          <div className="db-card-body" style={{ padding: 0 }}>
            <div className="db-activity-scroll">
              {ACTIVITY.map((a, i) => (
                <div key={i} className="db-activity-item" style={{ padding: '9px 16px' }}>
                  <div className="db-activity-icon" style={{ background: a.bg, color: a.iconColor, fontSize: 12, fontWeight: 700 }}>
                    {a.icon}
                  </div>
                  <div>
                    <p className="db-activity-text">{a.text}</p>
                    <p className="db-activity-time">{a.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
