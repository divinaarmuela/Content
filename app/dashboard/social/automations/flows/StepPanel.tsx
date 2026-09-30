'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Lock, Plus, Trash2, X } from 'lucide-react'
import {
  CONDITION_OPERATORS, LABEL_LIMIT, MATCH_TYPES, MAX_MINUTES, MEDIA_TYPES, MESSAGE_LIMITS, UNAVAILABLE_TRIGGERS, WHATSAPP_EVENTS, WHATSAPP_EVENT_WORDS,
  newId, platformName, stepTitle, STEP_WORDS,
  type Bubble, type ConditionOperator, type FlowIssue, type FlowPlatform, type FlowStep, type MatchType, type MediaType, type TriggerKind,
} from '@/app/lib/flow-core'

/* ── small pieces ───────────────────────────────────────────────────────── */

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-secondary-13 font-medium">{label}</span>
      {children}
      {hint && <span className="text-secondary-13 text-muted-foreground">{hint}</span>}
    </label>
  )
}

function Pick<T extends string>({ value, options, onChange, disabled }: {
  value: T; options: readonly { value: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void; disabled?: boolean
}) {
  return (
    <Select value={value} onValueChange={v => onChange(v as T)} disabled={disabled}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent className="bg-popover">
        {options.map(o => <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

type Unit = 'minutes' | 'hours' | 'days'
const UNIT_MIN: Record<Unit, number> = { minutes: 1, hours: 60, days: 1440 }
const unitOf = (m: number): Unit => (m % 1440 === 0 ? 'days' : m % 60 === 0 ? 'hours' : 'minutes')

function Minutes({ value, onChange, disabled }: { value: number; onChange: (m: number) => void; disabled?: boolean }) {
  const unit = unitOf(value)
  return (
    <div className="grid grid-cols-[1fr_130px] gap-2">
      <Input
        type="number" min={1} inputMode="numeric" disabled={disabled}
        value={Number.isFinite(value) ? value / UNIT_MIN[unit] : ''}
        onChange={e => onChange(Math.round(Number(e.target.value) * UNIT_MIN[unit]))}
      />
      <Pick<Unit>
        value={unit} disabled={disabled}
        options={[{ value: 'minutes', label: 'minutes' }, { value: 'hours', label: 'hours' }, { value: 'days', label: 'days' }]}
        onChange={u => onChange(Math.max(1, Math.round((value / UNIT_MIN[unit]) * UNIT_MIN[u])))}
      />
    </div>
  )
}

const TRIGGER_OPTIONS: { value: TriggerKind; label: string }[] = [
  { value: 'comment_button', label: 'Someone taps a comment automation\'s button' },
  { value: 'dm_keyword', label: 'Any DM with a keyword — needs the owner' },
  { value: 'whatsapp_event', label: 'A WhatsApp event — needs the owner' },
]

const OPERATOR_WORDS: Record<ConditionOperator, string> = {
  equals: 'is', not_equals: 'is not', contains: 'contains', not_contains: 'does not contain', starts_with: 'starts with',
  ends_with: 'ends with', exists: 'is set', not_exists: 'is not set', matches: 'matches pattern',
}

/* ── the side panel ─────────────────────────────────────────────────────── */

export function StepPanel({ step, platform, issues, readOnly, onChange, onDelete, onClose }: {
  step: FlowStep
  platform: FlowPlatform
  issues: FlowIssue[]
  readOnly: boolean
  onChange: (next: FlowStep) => void
  onDelete: () => void
  onClose: () => void
}) {
  const set = (patch: Partial<FlowStep>) => onChange({ ...step, ...patch } as FlowStep)
  const mine = issues.filter(i => i.stepId === step.id)
  const limit = MESSAGE_LIMITS[platform]

  return (
    <div className="grid gap-4 rounded-card border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-secondary-13 text-muted-foreground">{STEP_WORDS[step.kind]}</p>
          <h3 className="text-card-title">{stepTitle(step)}</h3>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close the step"><X className="h-4 w-4" /></Button>
      </div>

      {mine.length > 0 && (
        <ul className="grid gap-1.5">
          {mine.map((i, n) => (
            <li key={n} className={`rounded-inner px-3 py-2 text-secondary-13 ${i.needsOwner || !i.blocks ? 'bg-tint-amber' : 'bg-tint-red'}`}>
              {i.needsOwner && <strong>Needs the owner&apos;s decision. </strong>}{i.message}
            </li>
          ))}
        </ul>
      )}

      {step.kind !== 'kept' && (
        <Field label="Name on the canvas (optional)">
          <Input
            value={step.label ?? ''} maxLength={LABEL_LIMIT} disabled={readOnly} placeholder={stepTitle({ ...step, label: null })}
            onChange={e => set({ label: e.target.value.trim() ? e.target.value : null })}
          />
        </Field>
      )}

      {step.kind === 'trigger' && (
        <>
          <Field label="Starts when">
            <Pick<TriggerKind>
              value={step.trigger.kind} disabled={readOnly} options={TRIGGER_OPTIONS}
              onChange={kind => set({ trigger: { ...step.trigger, kind } })}
            />
          </Field>
          {step.trigger.kind === 'comment_button' && (
            <p className="rounded-inner bg-tint-blue px-3 py-2 text-secondary-13">
              Someone comments on a post a comment automation is watching, gets its DM, and taps its button. Only then does this
              flow start — it never messages anyone who did not ask. Pointing an automation&apos;s button at a flow is the next
              piece to build; until then a saved flow waits here.
            </p>
          )}
          {step.trigger.kind === 'dm_keyword' && (
            <>
              <Field label="Keywords" hint="Separate with commas.">
                <Input
                  value={step.trigger.keywords.join(', ')} disabled={readOnly}
                  onChange={e => set({ trigger: { ...step.trigger, keywords: e.target.value.split(',').map(k => k.trim()).filter(Boolean) } })}
                />
              </Field>
              <Field label="Match">
                <Pick<MatchType>
                  value={step.trigger.matchType} disabled={readOnly}
                  options={MATCH_TYPES.map(m => ({ value: m, label: m === 'any' ? 'Any message' : m }))}
                  onChange={matchType => set({ trigger: { ...step.trigger, matchType } })}
                />
              </Field>
              <label className="flex items-center gap-2 text-secondary-13">
                <Switch
                  checked={step.trigger.onlyFirstMessage} disabled={readOnly}
                  onCheckedChange={v => set({ trigger: { ...step.trigger, onlyFirstMessage: v } })}
                />
                Only their first message ever
              </label>
            </>
          )}
          {step.trigger.kind === 'whatsapp_event' && (
            <Field label="Event">
              <Pick<string>
                value={step.trigger.eventType ?? 'message_read'} disabled={readOnly}
                options={WHATSAPP_EVENTS.map(e => ({ value: e, label: WHATSAPP_EVENT_WORDS[e] ?? e }))}
                onChange={eventType => set({ trigger: { ...step.trigger, eventType } })}
              />
            </Field>
          )}
          <div className="grid gap-1">
            <p className="text-secondary-13 font-medium">Not offered by Zernio</p>
            {UNAVAILABLE_TRIGGERS.map(t => (
              <p key={t.label} className="flex items-start gap-2 text-secondary-13 text-muted-foreground">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span><strong>{t.label}</strong> — {t.why}</span>
              </p>
            ))}
          </div>
        </>
      )}

      {step.kind === 'message' && (
        <>
          <Field
            label={step.media ? 'Text (optional)' : 'Message'}
            hint={<>
              {step.text.length}/{limit} on {platformName(platform)}. {'{{reply}}'} puts in what they last replied, when a
              “Wait for a reply” step saved it under that name. {platform === 'instagram' || platform === 'facebook'
                ? 'Zernio\'s flows cannot send buttons here — ask them to reply instead.' : ''}
            </>}
          >
            <Textarea rows={5} value={step.text} disabled={readOnly} onChange={e => set({ text: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-secondary-13">
            <Switch
              checked={!!step.media} disabled={readOnly}
              onCheckedChange={v => set({ media: v ? { type: 'image', url: '', caption: '' } : null })}
            />
            Send a picture or file
          </label>
          {step.media && (
            <>
              <Field label="Kind">
                <Pick<MediaType>
                  value={step.media.type} disabled={readOnly}
                  options={MEDIA_TYPES.map(m => ({ value: m, label: m }))}
                  onChange={type => set({ media: { ...step.media!, type } })}
                />
              </Field>
              <Field label="Web address (https://)">
                <Input value={step.media.url} disabled={readOnly} onChange={e => set({ media: { ...step.media!, url: e.target.value } })} />
              </Field>
              <Field label="Caption (optional)">
                <Input value={step.media.caption} disabled={readOnly} onChange={e => set({ media: { ...step.media!, caption: e.target.value } })} />
              </Field>
            </>
          )}
        </>
      )}

      {step.kind === 'wait_reply' && (
        <>
          <Field label="Wait up to" hint={`Then the “No reply” path. At most 30 days (${MAX_MINUTES} minutes).`}>
            <Minutes value={step.timeoutMinutes} disabled={readOnly} onChange={timeoutMinutes => set({ timeoutMinutes })} />
          </Field>
          <Field label="Keep their reply as" hint="A later message or condition can use it, e.g. {{reply}}.">
            <Input value={step.saveAs} disabled={readOnly} onChange={e => set({ saveAs: e.target.value.replace(/\s+/g, '_') })} />
          </Field>
        </>
      )}

      {step.kind === 'delay' && (
        <Field label="Wait" hint={`At most 30 days (${MAX_MINUTES} minutes).`}>
          <Minutes value={step.minutes} disabled={readOnly} onChange={minutes => set({ minutes })} />
        </Field>
      )}

      {step.kind === 'condition' && (
        <div className="grid gap-3">
          <p className="text-secondary-13 text-muted-foreground">
            The first rule that matches picks the path; none matching takes “Otherwise”.
          </p>
          {step.rules.map((r, i) => (
            <div key={r.id} className="grid gap-2 rounded-inner border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-secondary-13 font-medium">Rule {i + 1}</span>
                {!readOnly && step.rules.length > 1 && (
                  <Button size="icon" variant="ghost" aria-label="Remove rule"
                    onClick={() => set({ rules: step.rules.filter(x => x.id !== r.id) })}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <Input
                placeholder="What to check, e.g. reply" value={r.variable} disabled={readOnly}
                onChange={e => set({ rules: step.rules.map(x => (x.id === r.id ? { ...x, variable: e.target.value } : x)) })}
              />
              <Pick<ConditionOperator>
                value={r.operator} disabled={readOnly}
                options={CONDITION_OPERATORS.map(o => ({ value: o, label: OPERATOR_WORDS[o] }))}
                onChange={operator => set({ rules: step.rules.map(x => (x.id === r.id ? { ...x, operator } : x)) })}
              />
              {r.operator !== 'exists' && r.operator !== 'not_exists' && (
                <Input
                  placeholder="Value" value={r.value} disabled={readOnly}
                  onChange={e => set({ rules: step.rules.map(x => (x.id === r.id ? { ...x, value: e.target.value } : x)) })}
                />
              )}
            </div>
          ))}
          {!readOnly && (
            <Button size="sm" variant="outline" onClick={() => set({
              rules: [...step.rules, { id: newId('r', step.rules.map(r => r.id)), variable: 'reply', operator: 'contains', value: '' }],
            })}>
              <Plus className="h-4 w-4" /> Add a rule
            </Button>
          )}
        </div>
      )}

      {step.kind === 'tag' && (
        <>
          <Field label="Do">
            <Pick<'add' | 'remove'>
              value={step.action} disabled={readOnly}
              options={[{ value: 'add', label: 'Add a tag' }, { value: 'remove', label: 'Remove a tag' }]}
              onChange={action => set({ action })}
            />
          </Field>
          <Field label="Tag" hint="Kept on the person's contact in Zernio.">
            <Input value={step.tag} disabled={readOnly} onChange={e => set({ tag: e.target.value })} />
          </Field>
        </>
      )}

      {step.kind === 'ab_split' && (
        <Field label="Share that takes path A (%)" hint="The rest take path B, at random.">
          <Input
            type="number" min={0} max={100} value={step.percentage} disabled={readOnly}
            onChange={e => set({ percentage: Math.round(Number(e.target.value)) })}
          />
        </Field>
      )}

      {step.kind === 'handoff' && (
        <Field label="Note for the team" hint="The conversation is flagged for a person, and the flow stops.">
          <Textarea rows={3} value={step.note} disabled={readOnly} onChange={e => set({ note: e.target.value })} />
        </Field>
      )}

      {step.kind === 'kept' && (
        <div className="grid gap-2">
          <p className="text-secondary-13 text-muted-foreground">
            Made in Zernio&apos;s own builder. Kept exactly as it is when this flow is saved — change it in Zernio.
          </p>
          <pre className="max-h-60 overflow-auto rounded-inner bg-muted p-3 text-[12px]">
            {JSON.stringify({ type: step.zernioType, config: step.config }, null, 2)}
          </pre>
        </div>
      )}

      {!readOnly && step.kind !== 'trigger' && (
        <Button size="sm" variant="outline" className="justify-self-start" onClick={onDelete}>
          <Trash2 className="h-4 w-4" /> Delete this step
        </Button>
      )}
    </div>
  )
}

/* ── the phone preview ──────────────────────────────────────────────────── */

export function PhonePreview({ bubbles, handle, platform }: { bubbles: Bubble[]; handle: string; platform: FlowPlatform }) {
  return (
    <div className="mx-auto w-full max-w-[300px] rounded-[36px] border-[6px] border-foreground/80 bg-background p-2 shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-2 pb-2 pt-1">
        <div className="h-7 w-7 rounded-full bg-muted" />
        <div className="min-w-0">
          <p className="truncate text-secondary-13 font-semibold">{handle}</p>
          <p className="text-[11px] text-muted-foreground">{platformName(platform)} DM · preview</p>
        </div>
      </div>
      <div className="grid max-h-[420px] min-h-[260px] content-start gap-2 overflow-y-auto px-1 py-3">
        {bubbles.length === 0 && <p className="text-center text-secondary-13 text-muted-foreground">Nothing is sent yet.</p>}
        {bubbles.map((b, i) => {
          if (b.from === 'note') {
            return <p key={i} className="text-center text-[11px] text-muted-foreground">{b.text}</p>
          }
          if (b.from === 'them') {
            return (
              <div key={i} className="max-w-[80%] justify-self-start rounded-2xl rounded-bl-md bg-muted px-3 py-2 text-secondary-13 italic">
                {b.text}
              </div>
            )
          }
          return (
            <div key={i} className="grid max-w-[85%] gap-1 justify-self-end">
              {b.media && (b.media.type === 'image' && /^https:\/\//.test(b.media.url)
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={b.media.url} alt="" className="max-h-40 rounded-2xl object-cover" />
                : <div className="rounded-2xl bg-accent-blue/20 px-3 py-2 text-secondary-13">{b.media.type} attached</div>)}
              {b.text && (
                <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent-blue px-3 py-2 text-secondary-13 text-white">
                  {b.text}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
