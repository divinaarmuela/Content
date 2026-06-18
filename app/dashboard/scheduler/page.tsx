'use client'

import { useState } from 'react'
import { toast } from 'sonner'

interface ScheduleItem {
  id: string
  client: string
  title: string
  type: string
  platform: string
  driveUrl: string
  caption: string
  scheduledDate: string
  scheduledTime: string
  status: 'approved' | 'scheduled' | 'published'
  liveUrl: string
  assignee: string
}

const ITEMS: ScheduleItem[] = [
  { id: '1', client: 'Bloom Skincare', title: 'Skincare routine — 30s reel',   type: 'Reel',     platform: 'Instagram', driveUrl: 'drive.google.com/...', caption: 'Your morning routine just got an upgrade ✨ #skincare', scheduledDate: 'Jun 21', scheduledTime: '9:00 AM',  status: 'approved',   liveUrl: '', assignee: 'JR' },
  { id: '2', client: 'Vertex Legal',   title: 'Case study — TechCorp',         type: 'Carousel', platform: 'LinkedIn',  driveUrl: 'drive.google.com/...', caption: 'How we helped TechCorp navigate compliance in 2025.', scheduledDate: 'Jun 21', scheduledTime: '11:00 AM', status: 'approved',   liveUrl: '', assignee: 'SL' },
  { id: '3', client: 'Surge Coffee',   title: 'Cold brew launch campaign',      type: 'Reel',     platform: 'Instagram', driveUrl: 'drive.google.com/...', caption: 'Cold. Bold. Ready. Our cold brew is here 🧊', scheduledDate: 'Jun 22', scheduledTime: '8:00 AM',  status: 'scheduled',  liveUrl: 'instagram.com/p/abc123', assignee: 'AK' },
  { id: '4', client: 'Align Wellness', title: 'Mindfulness ep. 3',             type: 'Reel',     platform: 'TikTok',    driveUrl: 'drive.google.com/...', caption: 'Episode 3: breath work for busy mornings 🌿', scheduledDate: 'Jun 24', scheduledTime: '7:00 AM',  status: 'scheduled',  liveUrl: 'tiktok.com/@align/ep3', assignee: 'MW' },
  { id: '5', client: 'Apex Fitness',   title: 'Supplement stack overview',      type: 'Reel',     platform: 'Instagram', driveUrl: 'drive.google.com/...', caption: 'The stack that fuels our athletes 💪', scheduledDate: 'Jun 10', scheduledTime: '9:00 AM',  status: 'published',  liveUrl: 'instagram.com/p/xyz789', assignee: 'AK' },
]

const PLATFORM_COLORS: Record<string, { bg: string; color: string }> = {
  Instagram: { bg: '#fdf2ff', color: '#a21caf' },
  TikTok:    { bg: '#f0fdf4', color: '#15803d' },
  LinkedIn:  { bg: '#eff6ff', color: '#1d4ed8' },
  Facebook:  { bg: '#eff6ff', color: '#2563eb' },
}
const ASSIGNEE_COLORS: Record<string, string> = { AK: '#5d5fef', JR: '#f97316', MW: '#16a34a', SL: '#8b5cf6' }

export default function SchedulerPage() {
  const [items, setItems] = useState(ITEMS)
  const [filter, setFilter] = useState<'all' | 'approved' | 'scheduled' | 'published'>('all')

  const markScheduled = (id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, status: 'scheduled' } : i))
    const item = items.find(i => i.id === id)
    toast.success('Marked as scheduled', { description: item?.title })
  }

  const markPublished = (id: string, title: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, status: 'published', liveUrl: 'instagram.com/p/new' } : i))
    toast.success('Published!', { description: title })
  }

  const visible = filter === 'all' ? items : items.filter(i => i.status === filter)

  return (
    <div className="db-page">
      <div className="db-page-header">
        <div>
          <h1 className="db-page-title">Scheduler Queue</h1>
          <p className="db-page-sub">Only approved content appears here — {items.filter(i => i.status === 'approved').length} ready to schedule</p>
        </div>
        <div className="db-page-actions">
          {(['all','approved','scheduled','published'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`db-cal-filter${filter === f ? ' active' : ''}`}
              style={{ textTransform: 'capitalize' }}
            >
              {f === 'all' ? 'All' : f}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {visible.map(item => {
          const pc = PLATFORM_COLORS[item.platform] ?? { bg: '#f4f3f9', color: '#7b7990' }
          return (
            <div key={item.id} className="db-card" style={{ padding: 0 }}>
              <div style={{ display: 'flex', gap: 0, alignItems: 'stretch' }}>
                {/* Status stripe */}
                <div style={{
                  width: 4, borderRadius: '12px 0 0 12px', flexShrink: 0,
                  background: item.status === 'published' ? '#10b981' : item.status === 'scheduled' ? '#2563eb' : '#16a34a',
                }} />

                <div style={{ flex: 1, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  {/* Client + title */}
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <p style={{ fontSize: 11, color: '#5d5fef', fontWeight: 600, marginBottom: 2 }}>{item.client}</p>
                    <p style={{ fontSize: 13, fontWeight: 600, color: '#1f1b2e', marginBottom: 4 }}>{item.title}</p>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10, fontWeight: 500, padding: '2px 6px', borderRadius: 4, background: pc.bg, color: pc.color }}>{item.platform}</span>
                      <span style={{ fontSize: 10, fontWeight: 500, padding: '2px 6px', borderRadius: 4, background: '#f4f3f9', color: '#7b7990' }}>{item.type}</span>
                    </div>
                  </div>

                  {/* Caption preview */}
                  <div style={{ flex: 2, minWidth: 200 }}>
                    <p style={{ fontSize: 11, color: '#a8a5bb', marginBottom: 3 }}>Caption</p>
                    <p style={{ fontSize: 12, color: '#3d3a52', lineHeight: 1.5 }}>{item.caption}</p>
                  </div>

                  {/* Date/time */}
                  <div style={{ flexShrink: 0, textAlign: 'center', minWidth: 80 }}>
                    <p style={{ fontSize: 16, fontWeight: 700, color: '#1f1b2e', letterSpacing: '-0.02em' }}>{item.scheduledDate}</p>
                    <p style={{ fontSize: 11, color: '#a8a5bb', fontFamily: 'monospace' }}>{item.scheduledTime}</p>
                  </div>

                  {/* Drive link */}
                  <div style={{ flexShrink: 0 }}>
                    <a
                      href="#"
                      onClick={e => { e.preventDefault(); toast('Drive link opened') }}
                      style={{ fontSize: 11, color: '#5d5fef', fontWeight: 500, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1L11 6M11 6L6 11M11 6H1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      Drive
                    </a>
                  </div>

                  {/* Assignee */}
                  <div className="db-mini-av" style={{ background: ASSIGNEE_COLORS[item.assignee], flexShrink: 0 }}>
                    {item.assignee}
                  </div>

                  {/* Status + action */}
                  <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {item.status === 'approved' && (
                      <button className="db-btn db-btn-primary" style={{ fontSize: 11, padding: '5px 10px' }} onClick={() => markScheduled(item.id)}>
                        Mark scheduled
                      </button>
                    )}
                    {item.status === 'scheduled' && (
                      <>
                        <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 99, background: '#eff6ff', color: '#2563eb', fontWeight: 600 }}>Scheduled</span>
                        <button className="db-btn db-btn-success" style={{ fontSize: 11, padding: '5px 10px' }} onClick={() => markPublished(item.id, item.title)}>
                          Mark published
                        </button>
                      </>
                    )}
                    {item.status === 'published' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 99, background: '#f0fdf4', color: '#16a34a', fontWeight: 600 }}>Published</span>
                        {item.liveUrl && (
                          <a href={`https://${item.liveUrl}`} target="_blank" rel="noreferrer"
                            style={{ fontSize: 11, color: '#5d5fef', fontWeight: 500, textDecoration: 'none' }}>
                            Live ↗
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}

        {visible.length === 0 && (
          <div style={{ padding: '60px 0', textAlign: 'center', color: '#a8a5bb', fontSize: 13 }}>
            No items in this status. Items appear here once approved for scheduling.
          </div>
        )}
      </div>
    </div>
  )
}
