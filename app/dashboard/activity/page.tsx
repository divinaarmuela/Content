const EVENTS = [
  { user: 'AK', name: 'Akmal K.',    action: 'submitted for internal review', entity: 'BTS gym session — 60s cut',       client: 'Apex Fitness',   time: '2 min ago',   type: 'submit'   },
  { user: 'DV', name: 'Divina A.',   action: 'sent to client for review',      entity: 'May results carousel',            client: 'Align Wellness', time: '14 min ago',  type: 'client'   },
  { user: 'CL', name: 'Client',      action: 'approved',                        entity: 'Skincare routine — 30s reel',     client: 'Bloom Skincare', time: '32 min ago',  type: 'approve'  },
  { user: 'DV', name: 'Divina A.',   action: 'approved for scheduling',         entity: 'Skincare routine — 30s reel',     client: 'Bloom Skincare', time: '35 min ago',  type: 'schedule' },
  { user: 'MW', name: 'Marcus W.',   action: 'marked published · added live URL',entity: 'Cold brew launch campaign',      client: 'Surge Coffee',   time: '1 hr ago',    type: 'publish'  },
  { user: 'JR', name: 'Jake R.',     action: 'uploaded v2 after revision',      entity: 'Barista morning routine',         client: 'Surge Coffee',   time: '2 hr ago',    type: 'upload'   },
  { user: 'DV', name: 'Divina A.',   action: 'requested revision',              entity: 'Barista morning routine',         client: 'Surge Coffee',   time: '3 hr ago',    type: 'revision' },
  { user: 'SL', name: 'Sarah L.',    action: 'submitted for internal review',   entity: 'Brand story carousel — 5 slides', client: 'NovaBuild Co.',  time: '4 hr ago',    type: 'submit'   },
  { user: 'CL', name: 'Client',      action: 'requested changes',               entity: 'PT promo — 3 variant reels',      client: 'Apex Fitness',   time: '5 hr ago',    type: 'revision' },
  { user: 'DV', name: 'Divina A.',   action: 'assigned client change to editor',entity: 'PT promo — 3 variant reels',      client: 'Apex Fitness',   time: '5 hr ago',    type: 'assign'   },
  { user: 'AK', name: 'Akmal K.',    action: 'scheduled · Jun 22 9:00 AM',      entity: 'Cold brew launch campaign',       client: 'Surge Coffee',   time: 'Yesterday',   type: 'schedule' },
  { user: 'MW', name: 'Marcus W.',   action: 'uploaded v1 draft',               entity: 'Mindfulness ep. 3',               client: 'Align Wellness', time: 'Yesterday',   type: 'upload'   },
  { user: 'JR', name: 'Jake R.',     action: 'submitted for internal review',   entity: 'Thought leadership talking head', client: 'Vertex Legal',   time: 'Jun 15',      type: 'submit'   },
  { user: 'CL', name: 'Client',      action: 'approved',                        entity: 'Case study — TechCorp',           client: 'Vertex Legal',   time: 'Jun 14',      type: 'approve'  },
]

const TYPE_STYLE: Record<string, { bg: string; color: string; icon: string }> = {
  submit:   { bg: '#eeeefd', color: '#5d5fef', icon: '↑' },
  client:   { bg: '#fff7ed', color: '#f97316', icon: '→' },
  approve:  { bg: '#f0fdf4', color: '#16a34a', icon: '✓' },
  schedule: { bg: '#eff6ff', color: '#2563eb', icon: '◷' },
  publish:  { bg: '#f0fdf4', color: '#10b981', icon: '★' },
  upload:   { bg: '#fdf4ff', color: '#a21caf', icon: '↑' },
  revision: { bg: '#fef2f2', color: '#dc2626', icon: '↺' },
  assign:   { bg: '#fffbeb', color: '#d97706', icon: '→' },
}

const ASSIGNEE_COLORS: Record<string, string> = {
  AK: '#5d5fef', DV: '#ec4899', MW: '#16a34a', JR: '#f97316', SL: '#8b5cf6', CL: '#64748b',
}

export default function ActivityPage() {
  return (
    <div className="db-page">
      <div className="db-page-header">
        <div>
          <h1 className="db-page-title">Activity Log</h1>
          <p className="db-page-sub">Every status change, upload, comment and approval — timestamped</p>
        </div>
      </div>

      <div className="db-card">
        <div className="db-card-head">
          <span className="db-card-title">Recent activity</span>
          <span style={{ fontSize: 11, color: '#a8a5bb' }}>{EVENTS.length} events</span>
        </div>
        <div>
          {EVENTS.map((e, i) => {
            const s = TYPE_STYLE[e.type] ?? TYPE_STYLE.upload
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 12,
                padding: '12px 16px',
                borderBottom: i < EVENTS.length - 1 ? '1px solid #f4f3f9' : 'none',
              }}>
                {/* Icon */}
                <div style={{
                  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                  background: s.bg, color: s.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700,
                }}>
                  {s.icon}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#1f1b2e' }}>{e.name}</span>
                    <span style={{ fontSize: 12, color: '#7b7990' }}>{e.action}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                    <span style={{ fontSize: 12, color: '#3d3a52', fontWeight: 500 }}>{e.entity}</span>
                    <span style={{ fontSize: 10, color: '#a8a5bb' }}>·</span>
                    <span style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 4,
                      background: '#eeeefd', color: '#5d5fef', fontWeight: 500,
                    }}>
                      {e.client}
                    </span>
                  </div>
                </div>

                {/* Time + user avatar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: '#a8a5bb', fontFamily: 'monospace' }}>{e.time}</span>
                  <div className="db-mini-av" style={{ background: ASSIGNEE_COLORS[e.user] ?? '#a8a5bb' }}>
                    {e.user}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
