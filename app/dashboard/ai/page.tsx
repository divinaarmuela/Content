'use client'

import { useState } from 'react'

type Message = { role: 'ai' | 'user'; text: string; time: string }

const QUICK_PROMPTS = [
  'Draft a shoot brief',
  'Summarise May performance',
  'Flag overdue approvals',
  'Plan June content',
  'Write a status update',
  'Report commentary',
]

const CAPABILITIES = [
  'Draft shoot briefs & creative direction',
  'Summarise client performance data',
  'Flag overdue approvals & blockers',
  'Generate report commentary',
  'Write client status updates',
  'Suggest content ideas by platform',
]

const INITIAL: Message[] = [
  {
    role: 'ai',
    text: "Hi! I'm your MD Media AI assistant. I can help you draft briefs, summarise performance, flag approvals, and more. What do you need?",
    time: '9:00 AM',
  },
]

export default function AIPage() {
  const [messages, setMessages] = useState<Message[]>(INITIAL)
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)

  const send = async (text: string) => {
    if (!text.trim() || loading) return
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    setMessages(m => [...m, { role: 'user', text: text.trim(), time: t }])
    setInput('')
    setLoading(true)
    await new Promise(r => setTimeout(r, 900))
    setMessages(m => [...m, {
      role: 'ai',
      text: `Got it — working on "${text.trim()}". This will be connected to the Claude API. The integration point is in /dashboard/ai/page.tsx.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }])
    setLoading(false)
  }

  return (
    <div className="db-page" style={{ maxWidth: '100%' }}>
      <div className="db-page-header">
        <div>
          <h1 className="db-page-title">
            AI Assistant{' '}
            <span style={{ fontSize: 11, fontWeight: 500, color: '#5d5fef', background: '#eeeefd', padding: '2px 8px', borderRadius: 99, verticalAlign: 'middle' }}>
              Beta
            </span>
          </h1>
          <p className="db-page-sub">Powered by Claude · mdmmarketing.com.au</p>
        </div>
      </div>

      <div className="db-ai-layout">
        {/* Left panel */}
        <div className="db-ai-prompts">
          <p style={{ fontSize: 11, fontWeight: 600, color: '#a8a5bb', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>
            Quick Prompts
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 24 }}>
            {QUICK_PROMPTS.map(p => (
              <button
                key={p}
                onClick={() => send(p)}
                style={{
                  background: '#f4f3f9',
                  border: '1px solid #e8e7ef',
                  borderRadius: 7,
                  padding: '8px 12px',
                  color: '#4a4560',
                  fontSize: 12,
                  fontWeight: 500,
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'all 0.12s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#eeeefd'; (e.currentTarget as HTMLButtonElement).style.color = '#5d5fef' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#f4f3f9'; (e.currentTarget as HTMLButtonElement).style.color = '#4a4560' }}
              >
                {p} →
              </button>
            ))}
          </div>

          <p style={{ fontSize: 11, fontWeight: 600, color: '#a8a5bb', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>
            Capabilities
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {CAPABILITIES.map(c => (
              <li key={c} style={{ fontSize: 12, color: '#7b7990', marginBottom: 6, paddingLeft: 14, position: 'relative', lineHeight: 1.5 }}>
                <span style={{ position: 'absolute', left: 0, color: '#5d5fef', fontWeight: 700 }}>·</span>
                {c}
              </li>
            ))}
          </ul>
        </div>

        {/* Chat */}
        <div className="db-ai-chat">
          <div className="db-ai-messages">
            {messages.map((m, i) => (
              <div key={i}>
                <div className={`db-ai-msg ${m.role}`}>{m.text}</div>
                <p style={{ fontSize: 10, color: '#a8a5bb', marginTop: 3, textAlign: m.role === 'user' ? 'right' : 'left' }}>
                  {m.time}
                </p>
              </div>
            ))}
            {loading && (
              <div className="db-ai-msg ai" style={{ opacity: 0.5 }}>Thinking...</div>
            )}
          </div>
          <div className="db-ai-input-row">
            <input
              className="db-ai-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send(input)}
              placeholder="Ask about clients, content, approvals, reports..."
            />
            <button
              onClick={() => send(input)}
              disabled={loading || !input.trim()}
              className="db-btn db-btn-primary"
              style={{ opacity: loading || !input.trim() ? 0.4 : 1 }}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
