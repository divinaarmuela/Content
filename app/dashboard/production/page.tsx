'use client'

import { useState } from 'react'
import { toast } from 'sonner'

type Status =
  | 'draft_uploaded'
  | 'internal_review'
  | 'revision_required'
  | 'client_review'
  | 'approved_scheduling'
  | 'scheduled'
  | 'published'

interface Card {
  id: string
  client: string
  batch: string
  title: string
  type: 'Reel' | 'Carousel' | 'Static' | 'Story'
  platforms: string[]
  assignee: string
  due: string
  version: number
  hasDropbox: boolean
  hasDrive: boolean
  status: Status
}

const INITIAL_CARDS: Card[] = [
  { id: '1',  client: 'Apex Fitness',   batch: 'June Shoot',    title: 'BTS gym session — 60s cut',      type: 'Reel',     platforms: ['ig','tt'],    assignee: 'AK', due: 'Jun 20', version: 1, hasDropbox: true,  hasDrive: false, status: 'draft_uploaded' },
  { id: '2',  client: 'Bloom Skincare', batch: 'May Campaign',  title: 'Product flat lay — hero shot',   type: 'Static',   platforms: ['ig'],         assignee: 'MW', due: 'Jun 19', version: 2, hasDropbox: true,  hasDrive: true,  status: 'internal_review' },
  { id: '3',  client: 'Vertex Legal',   batch: 'Brand Refresh', title: 'Thought leadership talking head',type: 'Reel',     platforms: ['li'],         assignee: 'JR', due: 'Jun 21', version: 1, hasDropbox: true,  hasDrive: true,  status: 'internal_review' },
  { id: '4',  client: 'Surge Coffee',   batch: 'June Content',  title: 'Barista morning routine',        type: 'Reel',     platforms: ['tt','ig'],    assignee: 'AK', due: 'Jun 17', version: 3, hasDropbox: true,  hasDrive: true,  status: 'revision_required' },
  { id: '5',  client: 'NovaBuild Co.',  batch: 'Launch Pack',   title: 'Brand story carousel — 5 slides',type: 'Carousel', platforms: ['ig','li'],    assignee: 'SL', due: 'Jun 22', version: 1, hasDropbox: true,  hasDrive: true,  status: 'revision_required' },
  { id: '6',  client: 'Align Wellness', batch: 'May Recap',     title: 'May results carousel',           type: 'Carousel', platforms: ['ig'],         assignee: 'MW', due: 'Jun 18', version: 2, hasDropbox: true,  hasDrive: true,  status: 'client_review' },
  { id: '7',  client: 'Apex Fitness',   batch: 'June Shoot',    title: 'PT promo — 3 variant reels',     type: 'Reel',     platforms: ['ig','fb'],    assignee: 'AK', due: 'Jun 16', version: 2, hasDropbox: true,  hasDrive: true,  status: 'client_review' },
  { id: '8',  client: 'Bloom Skincare', batch: 'Summer Drop',   title: 'Skincare routine — 30s reel',    type: 'Reel',     platforms: ['ig','tt'],    assignee: 'JR', due: 'Jun 15', version: 1, hasDropbox: true,  hasDrive: true,  status: 'approved_scheduling' },
  { id: '9',  client: 'Vertex Legal',   batch: 'Brand Refresh', title: 'Case study — TechCorp',          type: 'Carousel', platforms: ['li'],         assignee: 'SL', due: 'Jun 15', version: 1, hasDropbox: true,  hasDrive: true,  status: 'approved_scheduling' },
  { id: '10', client: 'Surge Coffee',   batch: 'Cold Brew',     title: 'Cold brew launch campaign',      type: 'Reel',     platforms: ['ig','fb'],    assignee: 'MW', due: 'Jun 21', version: 1, hasDropbox: true,  hasDrive: true,  status: 'scheduled' },
  { id: '11', client: 'Align Wellness', batch: 'Series',        title: 'Mindfulness ep. 3',              type: 'Reel',     platforms: ['tt'],         assignee: 'AK', due: 'Jun 24', version: 1, hasDropbox: true,  hasDrive: true,  status: 'scheduled' },
  { id: '12', client: 'Apex Fitness',   batch: 'May Content',   title: 'Supplement stack overview',      type: 'Reel',     platforms: ['ig','tt'],    assignee: 'AK', due: 'Jun 10', version: 1, hasDropbox: true,  hasDrive: true,  status: 'published' },
  { id: '13', client: 'Bloom Skincare', batch: 'May Campaign',  title: 'SPF routine — morning reel',     type: 'Reel',     platforms: ['ig'],         assignee: 'MW', due: 'Jun 9',  version: 1, hasDropbox: true,  hasDrive: true,  status: 'published' },
]

const COLUMNS: { id: Status; label: string; color: string; clientLabel: string }[] = [
  { id: 'draft_uploaded',      label: 'Draft Uploaded',       color: '#a8a5bb', clientLabel: 'In production' },
  { id: 'internal_review',     label: 'Internal Review',      color: '#5d5fef', clientLabel: 'In production' },
  { id: 'revision_required',   label: 'Revision Required',    color: '#f97316', clientLabel: 'In production' },
  { id: 'client_review',       label: 'Client Review',        color: '#d97706', clientLabel: 'Needs your review' },
  { id: 'approved_scheduling', label: 'Approved for Sched.',  color: '#16a34a', clientLabel: 'Approved' },
  { id: 'scheduled',           label: 'Scheduled',            color: '#2563eb', clientLabel: 'Scheduled' },
  { id: 'published',           label: 'Published',            color: '#10b981', clientLabel: 'Published' },
]

const NEXT_STATUS: Partial<Record<Status, { label: string; next: Status; variant: 'primary' | 'warning' | 'success' }>> = {
  draft_uploaded:      { label: 'Submit for review', next: 'internal_review',     variant: 'primary' },
  internal_review:     { label: 'Send to client',    next: 'client_review',       variant: 'primary' },
  revision_required:   { label: 'Mark revised',      next: 'internal_review',     variant: 'warning' },
  client_review:       { label: 'Approve for sched.',next: 'approved_scheduling', variant: 'success' },
  approved_scheduling: { label: 'Mark scheduled',    next: 'scheduled',           variant: 'primary' },
  scheduled:           { label: 'Mark published',    next: 'published',           variant: 'success' },
}

const PLATFORM_LABELS: Record<string, string> = { ig: 'IG', tt: 'TT', li: 'LI', fb: 'FB' }
const ASSIGNEE_COLORS: Record<string, string>  = { AK: '#5d5fef', JR: '#f97316', MW: '#16a34a', SL: '#8b5cf6' }
const TYPE_COLORS: Record<string, string>      = { Reel: '#eeeefd', Carousel: '#fff7ed', Static: '#f0fdf4', Story: '#fdf4ff' }
const TYPE_TEXT: Record<string, string>        = { Reel: '#5d5fef', Carousel: '#f97316', Static: '#16a34a', Story: '#a21caf' }

export default function ProductionPage() {
  const [cards, setCards] = useState<Card[]>(INITIAL_CARDS)

  const advance = (card: Card) => {
    const next = NEXT_STATUS[card.status]
    if (!next) return
    if (card.status === 'draft_uploaded' && (!card.hasDropbox || !card.hasDrive)) {
      toast.error('Missing links', { description: 'Add Dropbox and Drive links before submitting.' })
      return
    }
    setCards(cs => cs.map(c => c.id === card.id ? { ...c, status: next.next } : c))
    toast.success(next.label, { description: `${card.client} — ${card.title}` })
  }

  const requestRevision = (card: Card) => {
    setCards(cs => cs.map(c => c.id === card.id ? { ...c, status: 'revision_required' } : c))
    toast.warning('Revision requested', { description: `${card.client} — ${card.title}` })
  }

  const byStatus = (s: Status) => cards.filter(c => c.status === s)

  return (
    <div className="db-page" style={{ maxWidth: '100%' }}>
      <div className="db-page-header">
        <div>
          <h1 className="db-page-title">Production Board</h1>
          <p className="db-page-sub">{cards.length} items · {cards.filter(c => c.status === 'published').length} published this month</p>
        </div>
        <div className="db-page-actions">
          <button className="db-btn db-btn-outline" onClick={() => toast('Filters coming soon')}>Filter</button>
          <button className="db-btn db-btn-primary" onClick={() => toast.success('Task created', { description: 'Added to Draft Uploaded.' })}>+ New item</button>
        </div>
      </div>

      <div className="db-kanban">
        {COLUMNS.map(col => {
          const colCards = byStatus(col.id)
          return (
            <div key={col.id} className="db-kanban-col">
              <div className="db-kanban-col-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: col.color, flexShrink: 0 }} />
                  <span className="db-kanban-col-title">{col.label}</span>
                </div>
                <span className="db-kanban-count">{colCards.length}</span>
              </div>

              <div className="db-kanban-cards">
                {colCards.map(card => {
                  const nextAction = NEXT_STATUS[card.status]
                  return (
                    <div key={card.id} className="db-kanban-card">
                      {/* Client + batch */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                        <p className="db-kanban-card-client">{card.client}</p>
                        <span style={{ fontSize: 10, color: '#a8a5bb', fontFamily: 'monospace' }}>v{card.version}</span>
                      </div>
                      <p style={{ fontSize: 10, color: '#a8a5bb', marginBottom: 4 }}>{card.batch}</p>

                      {/* Title */}
                      <p className="db-kanban-card-title">{card.title}</p>

                      {/* Type + platforms */}
                      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: TYPE_COLORS[card.type], color: TYPE_TEXT[card.type] }}>
                          {card.type}
                        </span>
                        {card.platforms.map(p => (
                          <span key={p} className={`db-tag ${p}`}>{PLATFORM_LABELS[p]}</span>
                        ))}
                      </div>

                      {/* Links */}
                      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                        <span style={{
                          fontSize: 10, padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace',
                          background: card.hasDropbox ? '#f0fdf4' : '#fef2f2',
                          color: card.hasDropbox ? '#16a34a' : '#dc2626',
                        }}>
                          {card.hasDropbox ? '✓' : '✗'} Dropbox
                        </span>
                        <span style={{
                          fontSize: 10, padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace',
                          background: card.hasDrive ? '#f0fdf4' : '#fef2f2',
                          color: card.hasDrive ? '#16a34a' : '#dc2626',
                        }}>
                          {card.hasDrive ? '✓' : '✗'} Drive
                        </span>
                      </div>

                      {/* Footer */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                        <div className="db-mini-av" style={{ background: ASSIGNEE_COLORS[card.assignee] }} title={card.assignee}>
                          {card.assignee}
                        </div>
                        <span style={{ fontSize: 10, color: '#a8a5bb', fontFamily: 'monospace', flex: 1, paddingLeft: 4 }}>{card.due}</span>
                        {nextAction && (
                          <button
                            onClick={() => advance(card)}
                            style={{
                              fontSize: 10, fontWeight: 600, padding: '3px 7px', borderRadius: 4,
                              border: 'none', cursor: 'pointer',
                              background: nextAction.variant === 'success' ? '#16a34a' : nextAction.variant === 'warning' ? '#f97316' : '#5d5fef',
                              color: '#fff',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {nextAction.label}
                          </button>
                        )}
                      </div>

                      {/* Request revision (only on internal_review / client_review) */}
                      {(card.status === 'internal_review' || card.status === 'client_review') && (
                        <button
                          onClick={() => requestRevision(card)}
                          style={{
                            marginTop: 6, fontSize: 10, fontWeight: 500, padding: '3px 7px',
                            borderRadius: 4, border: '1px solid #e8e7ef', cursor: 'pointer',
                            background: 'transparent', color: '#7b7990', width: '100%',
                          }}
                        >
                          Request revision
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>

              <button
                className="db-add-card-btn"
                onClick={() => toast.success('Item created', { description: `Added to ${col.label}.` })}
              >
                <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> Add item
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
