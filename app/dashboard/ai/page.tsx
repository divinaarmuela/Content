'use client'

import { useEffect, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Bot, Loader2, SendHorizontal, ShieldAlert, Sparkles, Wrench,
} from 'lucide-react'

/**
 * The dashboard assistant, for real: an agent over the agency's own data.
 *
 * Everything the model does is visible. Read tools render as activity rows
 * ("Searching clients…"), and the write tools stop the loop and render an
 * approval card — nothing changes in the database until the person clicks
 * Approve, and Deny tells the model no.
 */

const TOOL_LABELS: Record<string, string> = {
  search_clients: 'Searching clients',
  get_client: 'Reading client profile',
  get_leads: 'Reading leads',
  get_schedule: 'Reading the schedule',
  get_intake_status: 'Checking intake forms',
  get_scanner_status: 'Checking the inbox scanner',
  get_team: 'Reading the team',
  update_client: 'Editing client',
  update_lead_note: 'Editing lead',
}

const SUGGESTIONS = [
  'Which clients have not submitted their intake form?',
  'What did the inbox scanner find in the last 24 hours?',
  'How many leads came in this month, and from where?',
  'Who is on the team and what are their roles?',
]

function ToolRow({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex w-fit items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
      {done
        ? <Wrench className="h-3 w-3" />
        : <Loader2 className="h-3 w-3 animate-spin" />}
      <span>{label}{done ? '' : '…'}</span>
    </div>
  )
}

function ApprovalCard({ title, detail, onDecide }: {
  title: string
  detail: string
  onDecide: (approved: boolean) => void
}) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
        <ShieldAlert className="h-4 w-4" /> {title} — approval needed
      </div>
      <p className="mt-1 break-all font-mono text-xs text-amber-800 dark:text-amber-300">{detail}</p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => onDecide(true)}>Approve</Button>
        <Button size="sm" variant="outline" onClick={() => onDecide(false)}>Deny</Button>
      </div>
    </div>
  )
}

export default function AssistantPage() {
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  /** whether the reader is at the bottom — the only case where we follow the stream */
  const pinned = useRef(true)

  const { messages, sendMessage, addToolApprovalResponse, status, error } = useChat({
    transport: new DefaultChatTransport({ api: '/api/assistant' }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  })

  const busy = status === 'submitted' || status === 'streaming'

  /**
   * Stick-to-bottom, not force-to-bottom. Following on every update means
   * every streamed token yanks the page down while someone is reading an
   * earlier answer. So: scrolling up unpins; only a pinned reader follows.
   * Scroll the container directly — scrollIntoView also scrolls ancestors,
   * which is what made the whole page jump.
   */
  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  useEffect(() => {
    const el = scrollRef.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const send = (text: string) => {
    const t = text.trim()
    if (!t || busy) return
    setInput('')
    pinned.current = true
    void sendMessage({ text: t })
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-9rem)] w-full max-w-3xl flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto pr-1">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted">
              <Sparkles className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Ask about your agency</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Clients, leads, intake forms, the schedule, the scanner, the team.
                Edits always ask you first.
              </p>
            </div>
            <div className="grid w-full gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => send(s)}
                  className="rounded-lg border border-border bg-card px-3 py-2.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-4 py-4">
          {messages.map(m => (
            <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              {m.role === 'user' ? (
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                  {m.parts.map(p => p.type === 'text' ? p.text : '').join('')}
                </div>
              ) : (
                <div className="flex w-full max-w-[95%] gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
                    <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    {m.parts.map((part, i) => {
                      if (part.type === 'text') {
                        return part.text
                          ? <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed">{part.text}</p>
                          : null
                      }

                      if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
                        const p = part as unknown as {
                          type: string
                          state: string
                          toolCallId: string
                          toolName?: string
                          input?: unknown
                          approval?: { id: string }
                        }
                        const name = p.toolName ?? p.type.slice(5)
                        const label = TOOL_LABELS[name] ?? name

                        if (p.state === 'approval-requested' && p.approval) {
                          const approvalId = p.approval.id
                          return (
                            <ApprovalCard key={p.toolCallId}
                              title={label}
                              detail={JSON.stringify(p.input)}
                              onDecide={approved =>
                                addToolApprovalResponse({ id: approvalId, approved })}
                            />
                          )
                        }
                        return (
                          <ToolRow key={p.toolCallId} label={label}
                            done={p.state === 'output-available' || p.state === 'output-error' || p.state === 'approval-responded'} />
                        )
                      }
                      return null
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}

          {busy && messages[messages.length - 1]?.role === 'user' && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Thinking
            </div>
          )}
          {error && (
            <p className="text-xs text-destructive">Something went wrong: {error.message}</p>
          )}
        </div>
      </div>

      <div className="border-t border-border pt-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
            }}
            placeholder="Ask about clients, leads, the schedule…"
            rows={1}
            className="max-h-40 min-h-[44px] flex-1 resize-none text-base sm:text-sm"
          />
          <Button size="icon" onClick={() => send(input)} disabled={busy || !input.trim()}
            className="h-11 w-11 shrink-0">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Answers come from live agency data. Edits always ask for approval first.
        </p>
      </div>
    </div>
  )
}
