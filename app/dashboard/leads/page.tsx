'use client'

import { useEffect, useState, useCallback } from 'react'
import * as XLSX from 'xlsx'

interface Lead {
  id: string
  created_at: string
  fname: string
  lname: string
  email: string
  phone: string
  biz: string
  model: string
  need: string
  budget: string
  timeline: string
}

const WRAP_COLS = new Set<keyof Lead>(['model', 'need'])

const COLS: { key: keyof Lead; label: string; width?: number }[] = [
  { key: 'created_at', label: 'Date',     width: 140 },
  { key: 'fname',      label: 'First',    width: 100 },
  { key: 'lname',      label: 'Last',     width: 100 },
  { key: 'email',      label: 'Email',    width: 200 },
  { key: 'phone',      label: 'Phone',    width: 130 },
  { key: 'biz',        label: 'Business', width: 180 },
  { key: 'model',      label: 'Service',  width: 200 },
  { key: 'need',       label: 'Needs',    width: 200 },
  { key: 'budget',     label: 'Budget',   width: 120 },
  { key: 'timeline',   label: 'Timeline', width: 130 },
]

export default function LeadsPage() {
  const [leads, setLeads]     = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [search, setSearch]   = useState('')
  const [sort, setSort]       = useState<{ key: keyof Lead; dir: 'asc' | 'desc' }>({ key: 'created_at', dir: 'desc' })

  const fetchLeads = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/leads')
      if (!res.ok) throw new Error(`${res.status}`)
      setLeads(await res.json())
    } catch {
      setError('Could not load leads. Check Supabase config.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchLeads() }, [fetchLeads])

  const toggleSort = (key: keyof Lead) =>
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })

  const filtered = leads
    .filter(l => {
      if (!search) return true
      const q = search.toLowerCase()
      return [l.fname, l.lname, l.email, l.biz].some(v => v?.toLowerCase().includes(q))
    })
    .sort((a, b) => {
      const av = a[sort.key] ?? '', bv = b[sort.key] ?? ''
      return sort.dir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
    })

  const exportExcel = () => {
    const rows = filtered.map(l => ({
      Date:       l.created_at ? new Date(l.created_at).toLocaleString('en-AU') : '',
      'First name': l.fname,
      'Last name':  l.lname,
      Email:      l.email,
      Phone:      l.phone,
      Business:   l.biz,
      Service:    l.model,
      Needs:      l.need,
      Budget:     l.budget,
      Timeline:   l.timeline,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Leads')
    XLSX.writeFile(wb, `md-leads-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const fmt = (val: string, key: keyof Lead) => {
    if (key === 'created_at' && val)
      return new Date(val).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
    return val ?? '—'
  }

  return (
    <div className="db-page" style={{ maxWidth: '100%' }}>
      <div className="db-page-header">
        <div>
          <h1 className="db-page-title">Leads</h1>
          <p className="db-page-sub">Contact form submissions from mdmmarketing.com.au</p>
        </div>
        <div className="db-page-actions">
          <button onClick={fetchLeads} className="db-btn db-btn-outline">Refresh</button>
          <button
            onClick={exportExcel}
            disabled={filtered.length === 0}
            className="db-btn db-btn-success"
          >
            Export Excel ({filtered.length})
          </button>
        </div>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name, email, business..."
          style={{
            background: '#fff',
            border: '1px solid #e8e7ef',
            borderRadius: 8,
            padding: '8px 14px',
            color: '#1f1b2e',
            fontSize: 13,
            outline: 'none',
            width: 280,
          }}
        />
        {search && (
          <span style={{ fontSize: 12, color: '#a8a5bb' }}>
            {filtered.length} result{filtered.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {loading ? (
        <div className="db-table-empty">Loading leads...</div>
      ) : error ? (
        <div className="db-table-error">
          {error}<br />
          <span style={{ fontSize: 11, color: '#a8a5bb' }}>
            Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
          </span>
        </div>
      ) : (
        <div className="db-table-wrap">
          <table className="db-table">
            <thead>
              <tr>
                {COLS.map(c => (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    className={sort.key === c.key ? 'sorted' : ''}
                    style={{ minWidth: c.width }}
                  >
                    {c.label} {sort.key === c.key ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={COLS.length} className="db-table-empty">
                    No leads yet — submissions will appear here automatically.
                  </td>
                </tr>
              ) : (
                filtered.map((l, i) => (
                  <tr key={l.id ?? i}>
                    {COLS.map(c => (
                      <td
                        key={c.key}
                        className={`${c.key === 'created_at' || c.key === 'budget' || c.key === 'timeline' ? 'db-table-mono' : ''} ${WRAP_COLS.has(c.key) ? 'db-table-wrap-cell' : ''}`}
                        style={{ maxWidth: c.width }}
                      >
                        {c.key === 'email'
                          ? <a href={`mailto:${l.email}`} className="db-table-email">{l.email}</a>
                          : fmt(l[c.key], c.key)
                        }
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
