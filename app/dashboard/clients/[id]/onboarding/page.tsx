'use client'

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Copy, Monitor, Plus, Smartphone, Trash2 } from 'lucide-react'
import { render } from '@react-email/components'
import OnboardingEmail from '../../../../emails/OnboardingEmail'
import {
  ONBOARDING_LIMITS, applyTemplate, onboardingProblems,
  type OnboardingDraft, type OnboardingRow, type OnboardingStep,
} from '../../../../lib/onboarding-email-core'

/**
 * ONBOARDING: the welcome email a new client gets once their agreement is signed (the owner, 13 Nov 2026). The words
 * on the left, the email exactly as it will look on the right. It starts filled in from the client's own record, so
 * the account manager edits rather than writes. NOTHING IS SENT FROM HERE (the owner, 13 Nov 2026: "copy to email body kind of thing … not send from here"): Copy email puts the designed email on the clipboard, to paste into a new email.
 */

type Loaded = {
  draft: OnboardingDraft
  suggested: OnboardingDraft
  saved: boolean
  updated_at: string | null
  updated_by_name: string | null
  portal_url: string | null
  asset_base: string
}

type Template = { id: string; name: string; draft: OnboardingDraft }

const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-foreground">{label}</span>
      {children}
    </label>
  )
}

function Part({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card className="shadow-none">
      <CardContent className="flex flex-col gap-4 p-5">
        <div>
          <h2 className="text-[16px] font-semibold text-foreground">{title}</h2>
          {hint && <p className="mt-1 text-[13px] text-muted-foreground">{hint}</p>}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

/** a list of two-part lines (a heading and what it says), with add and remove */
function Lines<T extends OnboardingRow | OnboardingStep>({ items, a, b, aLabel, bLabel, max, addLabel, onChange, blank }: {
  items: T[]; a: keyof T & string; b: keyof T & string; aLabel: string; bLabel: string
  max: number; addLabel: string; onChange: (next: T[]) => void; blank: T
}) {
  const set = (i: number, key: string, v: string) => onChange(items.map((it, n) => n === i ? { ...it, [key]: v } : it))
  return (
    <div className="flex flex-col gap-3">
      {items.map((it, i) => (
        <div key={i} className="flex items-start gap-2 rounded-[14px] border border-border p-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Input aria-label={`${aLabel} ${i + 1}`} placeholder={aLabel} value={String(it[a] ?? '')} onChange={e => set(i, a, e.target.value)} />
            <Textarea aria-label={`${bLabel} ${i + 1}`} placeholder={bLabel} rows={2} value={String(it[b] ?? '')} onChange={e => set(i, b, e.target.value)} />
          </div>
          <button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => onChange(items.filter((_, n) => n !== i))}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      {items.length < max && (
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => onChange([...items, blank])}>
          <Plus className="h-3.5 w-3.5" /> {addLabel}
        </Button>
      )}
    </div>
  )
}

export default function OnboardingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [data, setData] = useState<Loaded | null | undefined>(undefined)
  const [refused, setRefused] = useState('')
  const [draft, setDraft] = useState<OnboardingDraft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [width, setWidth] = useState<'desktop' | 'phone'>('desktop')
  const [view, setView] = useState<'edit' | 'preview'>('edit')
  const [frameHeight, setFrameHeight] = useState(900)
  // templates: the words under a name, to start any client from (the owner, 13 Nov 2026)
  const [templates, setTemplates] = useState<Template[]>([])
  const [templateName, setTemplateName] = useState('')
  const [savingTemplate, setSavingTemplate] = useState(false)
  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/clients/onboarding-templates', { cache: 'no-store' })
      if (res.ok) setTemplates((await res.json()).templates ?? [])
    } catch { /* the list stays as it was */ }
  }, [])
  useEffect(() => { void loadTemplates() }, [loadTemplates])
  const frame = useRef<HTMLIFrameElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${id}/onboarding`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) { setRefused(json.error ?? 'Could not open onboarding'); setData(null); return }
      setData(json); setDraft(json.draft); setDirty(false)
    } catch {
      setRefused('Could not open onboarding. Check your connection and try again.'); setData(null)
    }
  }, [id])
  useEffect(() => { void load() }, [load])

  // leaving with unsaved words asks first
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const patch = (next: Partial<OnboardingDraft>) => { setDraft(d => d ? { ...d, ...next } : d); setDirty(true) }

  // the same React Email template that will be sent, rendered here as the words change
  const [html, setHtml] = useState('')
  const portalUrl = data?.portal_url ?? null
  const assetBase = data?.asset_base || (typeof window === 'undefined' ? '' : window.location.origin)
  useEffect(() => {
    if (!draft) return
    let live = true
    const t = setTimeout(() => {
      render(<OnboardingEmail draft={draft} portalUrl={portalUrl} assetBase={assetBase} />)
        .then(out => { if (live) setHtml(out) })
        .catch(e => console.error('[onboarding] preview failed', e))
    }, 150)
    return () => { live = false; clearTimeout(t) }
  }, [draft, portalUrl, assetBase])
  const problems = useMemo(() => draft && data ? onboardingProblems(draft, { portalUrl: data.portal_url }) : [], [draft, data])

  const measure = () => {
    const h = frame.current?.contentDocument?.documentElement?.scrollHeight
    if (h) setFrameHeight(h)
  }
  useEffect(() => { const t = setTimeout(measure, 60); return () => clearTimeout(t) }, [html, width, view])

  /** the designed email onto the clipboard, as an email app will take it: the design, plus plain words as a fallback */
  const copyEmail = async () => {
    const doc = frame.current?.contentDocument
    if (!html || !doc?.body) { toast.error('The email is still loading. Try again in a moment.'); return }
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([doc.body.innerHTML], { type: 'text/html' }),
        'text/plain': new Blob([doc.body.innerText], { type: 'text/plain' }),
      })])
      toast.success('Email copied. Paste it into the body of a new email.')
    } catch {
      // an older browser, or one that refuses: select the email itself and copy that
      try {
        const sel = doc.getSelection()
        sel?.selectAllChildren(doc.body)
        const ok = doc.execCommand('copy')
        sel?.removeAllRanges()
        if (!ok) throw new Error('refused')
        toast.success('Email copied. Paste it into the body of a new email.')
      } catch {
        toast.error('Could not copy. Click inside the email, press Ctrl+A then Ctrl+C.')
      }
    }
  }

  const useTemplate = (id: string) => {
    const t = templates.find(x => x.id === id)
    if (!t || !data) return
    setDraft(applyTemplate(t.draft, data.suggested)); setDirty(true)
    toast.success(`"${t.name}" is in. The greeting and what we agreed are this client's own.`)
  }

  const saveTemplate = async () => {
    if (!draft) return
    const name = templateName.trim()
    if (!name) { toast.error('Give the template a name first'); return }
    setSavingTemplate(true)
    try {
      const res = await fetch('/api/clients/onboarding-templates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, draft }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not save the template')
      toast.success(json.replaced ? `Template "${name}" updated` : `Template "${name}" saved. It is now in the list on every client.`)
      setTemplateName('')
      void loadTemplates()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the template')
    } finally {
      setSavingTemplate(false)
    }
  }

  const save = async () => {
    if (!draft) return
    setBusy(true)
    try {
      const res = await fetch(`/api/clients/${id}/onboarding`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not save the draft')
      setDraft(json.draft); setDirty(false)
      setData(d => d ? { ...d, saved: true, updated_at: json.updated_at, updated_by_name: json.updated_by_name } : d)
      toast.success('Draft saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the draft')
    } finally {
      setBusy(false)
    }
  }

  if (data === undefined) return <div className="flex flex-col gap-3">{[0, 1].map(i => <Skeleton key={i} className="h-40" />)}</div>
  if (data === null || !draft) {
    return (
      <Card className="border-dashed shadow-none">
        <CardContent className="py-14 text-center text-body-15 text-muted-foreground">{refused}</CardContent>
      </Card>
    )
  }

  const status = dirty ? 'Changes not saved yet'
    : data.saved && data.updated_at ? `Saved ${when(data.updated_at)}${data.updated_by_name ? ` by ${data.updated_by_name}` : ''}`
    : 'Filled in from this client’s record. Not saved yet.'
  const seg = (on: boolean) => `inline-flex min-h-11 items-center gap-1.5 rounded-tile px-3 text-[13px] font-semibold transition-colors ${on ? 'bg-surface text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`

  return (
    <div className="flex flex-col gap-4" data-onboarding>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-section-title">Welcome email</h2>
          <p className="mt-1 max-w-2xl text-[14px] text-muted-foreground">
            What the client gets after their agreement is signed. Change the words on the left; the right shows the email as they will see it. When it is right, copy it and paste it into the body of a new email. Nothing is sent from here.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <span className="text-[13px] text-muted-foreground" role="status">{status}</span>
          <Button variant="outline" onClick={() => void save()} disabled={busy || !dirty && data.saved}>{busy ? 'Saving…' : 'Save draft'}</Button>
          <Button onClick={() => void copyEmail()}><Copy className="h-4 w-4" /> Copy email</Button>
        </div>
      </div>

      {/* a phone shows one side at a time */}
      <div className="inline-flex w-fit rounded-inner bg-foreground/[0.06] p-1 lg:hidden">
        <button type="button" className={seg(view === 'edit')} onClick={() => setView('edit')}>Edit</button>
        <button type="button" className={seg(view === 'preview')} onClick={() => setView('preview')}>Preview</button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ── the words ── */}
        <div className={`${view === 'edit' ? 'flex' : 'hidden'} min-w-0 flex-col gap-4 lg:flex`}>
          <Part title="Templates" hint="Start this client from a saved template, or save these words as a template for other clients. A template never carries another client's name or agreement.">
            <Field label="Start from a template">
              <select value="" onChange={e => { if (e.target.value) useTemplate(e.target.value) }} disabled={templates.length === 0}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-[14px] text-foreground disabled:opacity-60">
                <option value="">{templates.length === 0 ? 'No templates saved yet' : 'Choose a template…'}</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Save these words as a template">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input placeholder="Template name, e.g. Social retainer" value={templateName} maxLength={60} onChange={e => setTemplateName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void saveTemplate() } }} />
                <Button type="button" variant="outline" className="shrink-0" disabled={savingTemplate || !templateName.trim()} onClick={() => void saveTemplate()}>
                  {savingTemplate ? 'Saving…' : 'Save template'}
                </Button>
              </div>
            </Field>
          </Part>

          <Part title="Opening">
            <Field label="Subject"><Input value={draft.subject} maxLength={ONBOARDING_LIMITS.short} onChange={e => patch({ subject: e.target.value })} /></Field>
            <Field label="Greeting"><Input value={draft.greeting} maxLength={ONBOARDING_LIMITS.short} onChange={e => patch({ greeting: e.target.value })} /></Field>
            <Field label="First paragraph"><Textarea rows={3} value={draft.intro} onChange={e => patch({ intro: e.target.value })} /></Field>
          </Part>

          <Part title="What we agreed" hint="Taken from the Agreement tab. Check it against the signed agreement before this goes anywhere.">
            <Field label="Heading"><Input value={draft.agreedTitle} onChange={e => patch({ agreedTitle: e.target.value })} /></Field>
            <Lines items={draft.agreed} a="label" b="value" aLabel="Heading" bLabel="What it says" max={ONBOARDING_LIMITS.rows}
              addLabel="Add a line" blank={{ label: '', value: '' }} onChange={agreed => patch({ agreed })} />
          </Part>

          <Part title="How we work">
            <Field label="Heading"><Input value={draft.workTitle} onChange={e => patch({ workTitle: e.target.value })} /></Field>
            <Field label="Bold line"><Input value={draft.workHeadline} onChange={e => patch({ workHeadline: e.target.value })} /></Field>
            <Field label="Paragraph"><Textarea rows={3} value={draft.workBody} onChange={e => patch({ workBody: e.target.value })} /></Field>
          </Part>

          <Part title="What they will see" hint="A short tour of the portal.">
            <Field label="Heading"><Input value={draft.seeTitle} onChange={e => patch({ seeTitle: e.target.value })} /></Field>
            <Field label="Line under the heading"><Input value={draft.seeIntro} onChange={e => patch({ seeIntro: e.target.value })} /></Field>
            <Lines items={draft.see} a="title" b="body" aLabel="Title" bLabel="One line about it" max={ONBOARDING_LIMITS.steps}
              addLabel="Add a point" blank={{ title: '', body: '' }} onChange={see => patch({ see })} />
          </Part>

          <Part title="Their portal" hint={data.portal_url ? 'The button opens this client’s own portal link.' : 'This client has no portal link yet, so this part is left out of the email.'}>
            <Field label="Heading"><Input value={draft.portalTitle} onChange={e => patch({ portalTitle: e.target.value })} /></Field>
            <Field label="Paragraph"><Textarea rows={2} value={draft.portalBody} onChange={e => patch({ portalBody: e.target.value })} /></Field>
            <Field label="Button"><Input value={draft.portalButton} onChange={e => patch({ portalButton: e.target.value })} /></Field>
          </Part>

          <Part title="What we still need">
            <Field label="Heading"><Input value={draft.needTitle} onChange={e => patch({ needTitle: e.target.value })} /></Field>
            <Field label="Paragraph"><Textarea rows={4} value={draft.needBody} onChange={e => patch({ needBody: e.target.value })} /></Field>
          </Part>

          <Part title="A set-up call" hint="Paste your booking link to show the button. Leave the link empty for no button.">
            <Field label="Heading"><Input value={draft.callTitle} onChange={e => patch({ callTitle: e.target.value })} /></Field>
            <Field label="Paragraph"><Textarea rows={2} value={draft.callBody} onChange={e => patch({ callBody: e.target.value })} /></Field>
            <Field label="Button"><Input value={draft.callButton} onChange={e => patch({ callButton: e.target.value })} /></Field>
            <Field label="Booking link"><Input type="url" inputMode="url" placeholder="https://" value={draft.callUrl} onChange={e => patch({ callUrl: e.target.value.trim() })} /></Field>
          </Part>

          <Part title="What happens next">
            <Field label="Heading"><Input value={draft.nextTitle} onChange={e => patch({ nextTitle: e.target.value })} /></Field>
            <Lines items={draft.next} a="title" b="body" aLabel="Step" bLabel="One line about it" max={ONBOARDING_LIMITS.steps}
              addLabel="Add a step" blank={{ title: '', body: '' }} onChange={next => patch({ next })} />
          </Part>

          <Part title="Sign-off">
            <Field label="Last line"><Textarea rows={2} value={draft.signoff} onChange={e => patch({ signoff: e.target.value })} /></Field>
            <Field label="Signed"><Input value={draft.signature} onChange={e => patch({ signature: e.target.value })} /></Field>
          </Part>

          <button type="button" className="w-fit min-h-11 text-[13px] font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => { setDraft(data.suggested); setDirty(true); toast.message('Back to the words from this client’s record. Save to keep them.') }}>
            Start again from this client&rsquo;s record
          </button>
        </div>

        {/* ── the email ── */}
        <div className={`${view === 'preview' ? 'flex' : 'hidden'} min-w-0 flex-col gap-3 lg:flex`}>
          <div className="lg:sticky lg:top-4 flex max-h-[calc(100vh-2rem)] flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" title="Copy the subject" className="min-h-11 min-w-0 truncate text-left text-[13px] text-muted-foreground hover:text-foreground"
                onClick={() => { void navigator.clipboard.writeText(draft.subject).then(() => toast.success('Subject copied')).catch(() => toast.error('Could not copy the subject')) }}>
                <span className="font-semibold text-foreground">Subject:</span> {draft.subject || '—'} <Copy className="ml-1 inline h-3.5 w-3.5" />
              </button>
              <div className="hidden rounded-inner bg-foreground/[0.06] p-1 lg:inline-flex">
                <button type="button" className={seg(width === 'desktop')} onClick={() => setWidth('desktop')}><Monitor className="h-3.5 w-3.5" /> Computer</button>
                <button type="button" className={seg(width === 'phone')} onClick={() => setWidth('phone')}><Smartphone className="h-3.5 w-3.5" /> Phone</button>
              </div>
            </div>
            {problems.length > 0 && (
              <ul className="flex flex-col gap-1 rounded-[14px] border border-accent-amber/35 bg-tint-amber p-3 text-[13px] text-foreground">
                {problems.map(p => <li key={p}>{p}</li>)}
              </ul>
            )}
            <div className="min-h-0 overflow-y-auto rounded-card border border-border bg-[#0C0C0E]">
              <iframe ref={frame} title="The welcome email as the client will see it" srcDoc={html} sandbox="allow-same-origin" onLoad={measure}
                className="mx-auto block border-0" style={{ width: width === 'phone' ? 390 : '100%', maxWidth: '100%', height: frameHeight }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
