'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai'
import { Streamdown } from 'streamdown'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  History, Loader2, Mic, Plus, SendHorizontal, Settings2, ShieldAlert,
  Sparkles, Trash2, Wrench,
} from 'lucide-react'

/**
 * The dashboard assistant: an agent over the agency's own data, with history.
 *
 * Chats persist per signed-in user and each one is a URL —
 * /dashboard/ai/<chat-id> — so refreshing mid-conversation lands back in the
 * same chat instead of on a blank page. A brand-new chat starts on the base
 * route and quietly claims its URL after the first response completes.
 */

/** The instructions already forbid em dashes, but models slip; renders are
 *  where the guarantee lives. Em dash only, deliberately: en dashes carry
 *  ranges like "3–5 days" and replacing those would corrupt them. */
const noEmDash = (t: string) => t.replace(/\s*—\s*/g, ', ')

const TOOL_LABELS: Record<string, string> = {
  search_clients: 'Searching clients',
  get_client: 'Reading client profile',
  get_leads: 'Reading leads',
  get_schedule: 'Reading the schedule',
  get_intake_status: 'Checking intake forms',
  get_intake_answers: 'Reading intake answers',
  get_scanner_status: 'Checking the inbox scanner',
  get_team: 'Reading the team',
  get_asana_tasks: 'Reading Asana tasks',
  update_client: 'Editing client',
  update_lead_note: 'Editing lead',
}

const SUGGESTIONS = [
  'Which clients have not submitted their intake form?',
  'What did the inbox scanner find in the last 24 hours?',
  'How many leads came in this month, and from where?',
  'Who is on the team and what are their roles?',
]

type ChatSummary = { id: string; title: string; updated_at: string }
type UIMsg = ReturnType<typeof useChat>['messages'][number]

const shimmerText =
  'animate-shimmer bg-gradient-to-r from-muted-foreground via-foreground to-muted-foreground bg-[length:200%_100%] bg-clip-text text-transparent'

/** MD Media's thinking mark: an eight-ray spark, deliberately uneven so it
 *  reads as drawn rather than generated. It spins and breathes while the
 *  model works; currentColor so it inherits the theme. */
function Spark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
      strokeLinecap="round" className={className} aria-hidden>
      <path d="M12 2.2 12 8" />
      <path d="M12 16.5 12 21.8" />
      <path d="M2.6 12 8.2 12" />
      <path d="M16 12 21.4 12" />
      <path d="M5.2 5.6 9 9.2" />
      <path d="M15.2 15 18.6 18.2" />
      <path d="M18.4 5.4 15 8.9" />
      <path d="M8.8 15.2 5.6 18.6" />
    </svg>
  )
}

/**
 * Dictation via the browser's own speech engine (Web Speech API): no audio
 * ever touches our servers. Interim words land in the input as they are
 * recognised; the browser closes the session on silence. Hidden entirely
 * where the API does not exist.
 */
function useDictation(onText: (text: string) => void) {
  const recRef = useRef<{ stop: () => void } | null>(null)
  const [listening, setListening] = useState(false)
  const supported = typeof window !== 'undefined' &&
    Boolean((window as never as Record<string, unknown>).SpeechRecognition ||
            (window as never as Record<string, unknown>).webkitSpeechRecognition)

  const stop = () => { recRef.current?.stop(); setListening(false) }

  const start = () => {
    const w = window as never as Record<string, unknown>
    const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
      new () => {
        lang: string; interimResults: boolean; continuous: boolean
        onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void
        onend: () => void; onerror: () => void
        start: () => void; stop: () => void
      }
    const rec = new Ctor()
    rec.lang = 'en-AU'
    rec.interimResults = true
    rec.continuous = true
    rec.onresult = e => {
      let text = ''
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript
      onText(text.trim())
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    recRef.current = rec
    setListening(true)
    rec.start()
  }

  return { supported, listening, toggle: () => (listening ? stop() : start()) }
}

function ToolRow({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex w-fit items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
      {done ? <Wrench className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin" />}
      {done ? <span>{label}</span> : <span className={shimmerText}>{label}…</span>}
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
        <ShieldAlert className="h-4 w-4" /> {title}: approval needed
      </div>
      <p className="mt-1 break-all font-mono text-xs text-amber-800 dark:text-amber-300">{detail}</p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => onDecide(true)}>Approve</Button>
        <Button size="sm" variant="outline" onClick={() => onDecide(false)}>Deny</Button>
      </div>
    </div>
  )
}

/* ── the conversation itself, keyed by chat id ─────────────────────────── */

function Conversation({ chatId, initialMessages, onResponseDone }: {
  chatId: string
  initialMessages: UIMsg[]
  onResponseDone: () => void
}) {
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const dictation = useDictation(setInput)

  const { messages, sendMessage, addToolApprovalResponse, status, error } = useChat({
    id: chatId,
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: '/api/assistant' }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: onResponseDone,
  })

  const busy = status === 'submitted' || status === 'streaming'

  /** Stick-to-bottom, not force-to-bottom: scrolling up unpins; only a pinned
   *  reader follows the stream. Container-only scroll, never scrollIntoView. */
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
    <div className="flex min-w-0 flex-1 flex-col">
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
                <div className="flex w-full max-w-[95%] min-w-0 flex-col gap-2">
                    {m.parts.map((part, i) => {
                      if (part.type === 'text') {
                        return part.text
                          ? (
                            <div key={i} className="max-w-none text-sm leading-relaxed [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
                              <Streamdown>{noEmDash(part.text)}</Streamdown>
                            </div>
                          )
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
              )}
            </div>
          ))}

          {busy && (
            <div className="flex items-center gap-2.5">
              <Spark className="h-4 w-4 animate-spark text-foreground" />
              <span className={`text-sm ${shimmerText}`}>Thinking…</span>
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
          {dictation.supported && (
            <Button size="icon" variant={dictation.listening ? 'default' : 'outline'}
              onClick={dictation.toggle} className="h-11 w-11 shrink-0"
              aria-label={dictation.listening ? 'Stop dictating' : 'Dictate'}>
              <Mic className={dictation.listening ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'} />
            </Button>
          )}
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

/* ── history list (shared between the sidebar and the mobile sheet) ─────── */

function ChatList({ chats, activeId, onOpen, onAskDelete }: {
  chats: ChatSummary[]
  activeId: string
  onOpen: (id: string) => void
  onAskDelete: (chat: ChatSummary) => void
}) {
  if (chats.length === 0) {
    return <p className="px-2 py-4 text-xs text-muted-foreground">No previous chats yet.</p>
  }
  return (
    <div className="flex flex-col gap-0.5">
      {chats.map(c => (
        <div key={c.id}
          className={
            'group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm ' +
            (c.id === activeId ? 'bg-muted' : 'hover:bg-muted/60')
          }>
          <button onClick={() => onOpen(c.id)}
            className="min-w-0 flex-1 truncate text-left" title={c.title}>
            {c.title}
          </button>
          <button onClick={() => onAskDelete(c)}
            className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            aria-label={`Delete "${c.title}"`}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

/* ── settings sheet: standing instructions, per user ────────────────────── */

function SettingsSheet() {
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [instructions, setInstructions] = useState('')
  const [timezone, setTimezone] = useState('Australia/Melbourne')
  const [maxLen, setMaxLen] = useState(2000)
  const [saving, setSaving] = useState(false)

  const TIMEZONES = [
    'Australia/Melbourne', 'Australia/Sydney', 'Australia/Brisbane',
    'Australia/Adelaide', 'Australia/Perth', 'Australia/Hobart',
    'Australia/Darwin', 'Pacific/Auckland', 'Asia/Singapore', 'UTC',
  ]
  // whatever the account already has stays choosable even if it is not ours
  const zones = TIMEZONES.includes(timezone) ? TIMEZONES : [timezone, ...TIMEZONES]

  const load = useCallback(async () => {
    setLoaded(false)
    const res = await fetch('/api/assistant/prefs')
    if (!res.ok) { toast.error('Could not load assistant settings'); return }
    const json = await res.json()
    setInstructions(json.instructions ?? '')
    setTimezone(json.timezone || 'Australia/Melbourne')
    setMaxLen(json.max_length ?? 2000)
    setLoaded(true)
  }, [])

  useEffect(() => { if (open) void load() }, [open, load])

  const save = async () => {
    setSaving(true)
    const res = await fetch('/api/assistant/prefs', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instructions, timezone }),
    })
    setSaving(false)
    if (!res.ok) toast.error('Could not save')
    else toast.success('Saved')
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Assistant settings">
          <Settings2 className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Assistant behaviour</SheetTitle>
          <SheetDescription>
            Yours alone: how the assistant talks to you in every chat. Style and
            focus only, never permissions.
          </SheetDescription>
        </SheetHeader>

        {loaded ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Your timezone</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {zones.map(z => <SelectItem key={z} value={z}>{z.replace('_', ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                The assistant presents dates and times in this timezone.
              </p>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-1.5">
              <Label className="text-xs">Standing instructions</Label>
              <Textarea
                value={instructions}
                onChange={e => setInstructions(e.target.value.slice(0, maxLen))}
                placeholder={'e.g. Keep answers under five sentences.\nAlways include the client status when listing clients.'}
                className="min-h-48 flex-1 resize-none text-sm"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {instructions.length}/{maxLen}
              </span>
              <Button size="sm" onClick={() => void save()} disabled={saving}>
                {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null} Save
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

/* ── the page: history + conversation + settings ────────────────────────── */

export default function Assistant({ chatId, initialMessages }: {
  /** present when this is the /dashboard/ai/[chatId] page; absent for a new chat */
  chatId?: string
  initialMessages?: UIMsg[]
}) {
  const router = useRouter()
  const [localId, setLocalId] = useState<string>(() => chatId ?? crypto.randomUUID())
  const [initial, setInitial] = useState<UIMsg[]>(initialMessages ?? [])
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [confirmDelete, setConfirmDelete] = useState<ChatSummary | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const claimedUrl = useRef(Boolean(chatId))

  const refreshList = useCallback(async () => {
    const res = await fetch('/api/assistant/chats')
    if (res.ok) setChats((await res.json()).chats ?? [])
  }, [])

  useEffect(() => { void refreshList() }, [refreshList])

  /** After the first saved response, a new chat claims its URL in place —
   *  replaceState, not router.push, so the stream and state never remount.
   *  From then on a refresh resolves through the [chatId] page. */
  const onResponseDone = () => {
    void refreshList()
    if (!claimedUrl.current) {
      claimedUrl.current = true
      window.history.replaceState(null, '', `/dashboard/ai/${localId}`)
    }
  }

  const newChat = () => {
    setHistoryOpen(false)
    if (chatId) { router.push('/dashboard/ai'); return }
    setInitial([])
    claimedUrl.current = false
    window.history.replaceState(null, '', '/dashboard/ai')
    setLocalId(crypto.randomUUID())
  }

  const openChat = (id: string) => {
    setHistoryOpen(false)
    if (id !== localId) router.push(`/dashboard/ai/${id}`)
  }

  const doDelete = async (chat: ChatSummary) => {
    const res = await fetch(`/api/assistant/chats/${chat.id}`, { method: 'DELETE' })
    if (!res.ok) toast.error('Could not delete that chat')
    else {
      toast.success('Chat deleted')
      if (chat.id === localId) { newChat(); return }
    }
    void refreshList()
  }

  const list = (
    <ChatList chats={chats} activeId={localId}
      onOpen={openChat} onAskDelete={setConfirmDelete} />
  )

  return (
    <div className="flex h-[calc(100vh-9rem)] gap-4">
      {/* history, persistent on desktop */}
      <aside className="hidden w-56 shrink-0 flex-col md:flex">
        <div className="mb-2 flex items-center gap-1">
          <Button size="sm" variant="outline" className="flex-1 justify-start" onClick={newChat}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> New chat
          </Button>
          <SettingsSheet />
        </div>
        <div className="flex-1 overflow-y-auto">{list}</div>
      </aside>

      {/* history on mobile */}
      <div className="absolute right-4 top-4 flex gap-1 md:hidden">
        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Chat history">
              <History className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72">
            <SheetHeader><SheetTitle>Chats</SheetTitle></SheetHeader>
            <Button size="sm" variant="outline" className="mb-2 w-full justify-start" onClick={newChat}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> New chat
            </Button>
            <div className="overflow-y-auto">{list}</div>
          </SheetContent>
        </Sheet>
        <SettingsSheet />
      </div>

      <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-1">
        <Conversation key={localId} chatId={localId} initialMessages={initial}
          onResponseDone={onResponseDone} />
      </div>

      <AlertDialog open={Boolean(confirmDelete)} onOpenChange={o => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{confirmDelete?.title}&rdquo; will be gone for good. There is no undo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (confirmDelete) void doDelete(confirmDelete)
              setConfirmDelete(null)
            }}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
