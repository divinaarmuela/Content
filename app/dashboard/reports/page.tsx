'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

const TREND_DATA = [
  { week: 'W1', reach: 18200, engagement: 1230 },
  { week: 'W2', reach: 22400, engagement: 1680 },
  { week: 'W3', reach: 19800, engagement: 1410 },
  { week: 'W4', reach: 21200, engagement: 1800 },
]
const PLATFORM_DATA = [
  { name: 'Instagram', reach: 34200, engagement: 2900 },
  { name: 'TikTok',    reach: 28600, engagement: 1840 },
  { name: 'Facebook',  reach: 11200, engagement: 780  },
  { name: 'LinkedIn',  reach: 7600,  engagement: 600  },
]
const CLICKS_DATA = [
  { week: 'W1', clicks: 380 },
  { week: 'W2', clicks: 520 },
  { week: 'W3', clicks: 410 },
  { week: 'W4', clicks: 460 },
]

const CLIENTS = ['All Clients', 'Apex Fitness', 'Bloom Skincare', 'Align Wellness', 'Surge Coffee']
const METRICS = [
  { label: 'Total Reach',     value: '81,600', delta: '+12% vs Apr', up: true  },
  { label: 'Engagements',     value: '6,120',  delta: '+8% vs Apr',  up: true  },
  { label: 'Link Clicks',     value: '1,770',  delta: '-3% vs Apr',  up: false },
  { label: 'Follower Growth', value: '+847',   delta: 'across all',  up: true  },
]

const TOOLTIP_STYLE = {
  contentStyle: {
    background: '#fff',
    border: '1px solid #e8e7ef',
    borderRadius: 8,
    fontSize: 12,
    color: '#1f1b2e',
    boxShadow: '0 4px 16px rgba(31,27,46,0.08)',
  },
}

export default function ReportsPage() {
  const [client, setClient] = useState('All Clients')

  return (
    <div className="db-page">
      <div className="db-page-header">
        <div>
          <h1 className="db-page-title">Reports</h1>
          <p className="db-page-sub">Performance snapshot — May 2026</p>
        </div>
        <div className="db-page-actions">
          <button className="db-btn db-btn-outline" onClick={() => toast.loading('Generating PDF…', { duration: 2000 })}>Export PDF</button>
          <button className="db-btn db-btn-primary" onClick={() => toast.success('Report sent', { description: `Sent to ${client === 'All Clients' ? 'all clients' : client}.` })}>Send to client</button>
        </div>
      </div>

      {/* Client filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {CLIENTS.map(c => (
          <button
            key={c}
            onClick={() => setClient(c)}
            className={`db-cal-filter${client === c ? ' active' : ''}`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Metrics */}
      <div className="db-report-metrics">
        {METRICS.map(m => (
          <div key={m.label} className="db-metric-card">
            <p className="db-metric-label">{m.label}</p>
            <p className="db-metric-value" style={{ fontSize: 24 }}>{m.value}</p>
            <p className={`db-metric-delta${m.up ? '' : ' down'}`}>
              {m.up ? '↑' : '↓'} {m.delta}
            </p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="db-card">
          <div className="db-card-head">
            <span className="db-card-title">Reach &amp; Engagement Trend</span>
          </div>
          <div className="db-card-body">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={TREND_DATA}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0eff7" />
                <XAxis dataKey="week" stroke="#a8a5bb" tick={{ fontSize: 11 }} />
                <YAxis stroke="#a8a5bb" tick={{ fontSize: 11 }} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="reach" stroke="#5d5fef" strokeWidth={2} dot={false} name="Reach" />
                <Line type="monotone" dataKey="engagement" stroke="#16a34a" strokeWidth={2} dot={false} name="Engagement" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="db-card">
          <div className="db-card-head">
            <span className="db-card-title">Platform Breakdown</span>
          </div>
          <div className="db-card-body">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={PLATFORM_DATA}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0eff7" />
                <XAxis dataKey="name" stroke="#a8a5bb" tick={{ fontSize: 11 }} />
                <YAxis stroke="#a8a5bb" tick={{ fontSize: 11 }} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Bar dataKey="reach" fill="#5d5fef" name="Reach" radius={[3, 3, 0, 0]} />
                <Bar dataKey="engagement" fill="#10b981" name="Engagement" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="db-card">
          <div className="db-card-head">
            <span className="db-card-title">Link Clicks by Week</span>
          </div>
          <div className="db-card-body">
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={CLICKS_DATA}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0eff7" />
                <XAxis dataKey="week" stroke="#a8a5bb" tick={{ fontSize: 11 }} />
                <YAxis stroke="#a8a5bb" tick={{ fontSize: 11 }} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Bar dataKey="clicks" fill="#f97316" name="Clicks" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="db-card">
          <div className="db-card-head">
            <span className="db-card-title">Report Commentary</span>
          </div>
          <div className="db-card-body">
            <textarea
              defaultValue="May showed strong reach performance across Instagram and TikTok, with engagement up 8% month-on-month. Link clicks dipped slightly — recommend A/B testing CTA copy in June."
              style={{
                width: '100%',
                background: '#f4f3f9',
                border: '1px solid #e8e7ef',
                borderRadius: 8,
                padding: '10px 12px',
                color: '#3d3a52',
                fontSize: 13,
                lineHeight: 1.7,
                outline: 'none',
                resize: 'vertical',
                minHeight: 100,
                fontFamily: 'inherit',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
