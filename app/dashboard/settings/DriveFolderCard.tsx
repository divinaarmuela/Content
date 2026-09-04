'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { FolderOpen } from 'lucide-react'

/**
 * "Where do our files go?" — answered once, by pointing at the folder the
 * agency already uses.
 *
 * This app can only see folders it made itself, so the team's existing
 * "MD Media HQ" folder is invisible to it until somebody hands it over. The
 * Google folder chooser is what does the handing over: picking a folder there
 * grants this app access to that folder and everything in it.
 *
 * After that the screen shows what it found — one folder per client, already
 * sitting in "Clients" — and lines them up against the client list so a person
 * can check the matches before anything is saved. Nothing is created in Drive
 * until Save is pressed.
 */

// ── the Google chooser, loaded only when it is wanted ─────────────────────

type PickerDoc = { id?: string; name?: string }
type PickerData = { action?: string; docs?: PickerDoc[] }
type PickerView = {
  setSelectFolderEnabled(on: boolean): PickerView
  setIncludeFolders(on: boolean): PickerView
  setMimeTypes(types: string): PickerView
  setOwnedByMe(owned: boolean): PickerView
}
type PickerBuilder = {
  addView(view: PickerView): PickerBuilder
  setOAuthToken(token: string): PickerBuilder
  setDeveloperKey(key: string): PickerBuilder
  setAppId(id: string): PickerBuilder
  setTitle(title: string): PickerBuilder
  enableFeature(feature: string): PickerBuilder
  setCallback(cb: (data: PickerData) => void): PickerBuilder
  build(): { setVisible(on: boolean): void }
}
type GooglePicker = {
  picker: {
    DocsView: new (viewId?: string) => PickerView
    PickerBuilder: new () => PickerBuilder
    ViewId: { FOLDERS: string }
    Feature: { SUPPORT_DRIVES: string }
    Action: { PICKED: string; CANCEL: string }
  }
}
type Gapi = { load(name: string, cb: () => void): void }

declare global {
  interface Window {
    gapi?: Gapi
    google?: GooglePicker
  }
}

const PICKER_SCRIPT = 'https://apis.google.com/js/api.js'

/** Load Google's script once, on the first press — never on page load. */
function loadPickerScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.picker) return resolve()
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PICKER_SCRIPT}"]`)
    const onReady = () => {
      const gapi = window.gapi
      if (!gapi) return reject(new Error('no gapi'))
      gapi.load('picker', () => resolve())
    }
    if (existing) {
      if (window.gapi) onReady()
      else existing.addEventListener('load', onReady, { once: true })
      existing.addEventListener('error', () => reject(new Error('script failed')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = PICKER_SCRIPT
    script.async = true
    script.onload = onReady
    script.onerror = () => reject(new Error('script failed'))
    document.head.appendChild(script)
  })
}

// ── what the routes send back ─────────────────────────────────────────────

type Picked = {
  id: string
  name: string
  owner_email: string | null
  picked_at: string | null
  picked_by: string | null
  clients_folder_id: string | null
}

type RootState = {
  configured: boolean
  connected: boolean
  account_email: string | null
  picked: Picked | null
}

type PlanRow = {
  client_id: string
  client_name: string
  folder_id: string | null
  folder_name: string | null
  confidence: 'exact' | 'likely' | 'recorded' | null
  action: 'linked' | 'link' | 'create'
}

type Plan = {
  root: { id: string; name: string; owner_email: string | null }
  clients_folder_id: string | null
  needs_clients_folder: boolean
  rows: PlanRow[]
  folders: { id: string; name: string }[]
  extra: { id: string; name: string }[]
  matched: number
  total: number
  to_create: number
}

/** What each row is set to right now — 'create', or a folder id. */
type Choice = Record<string, string>

const CREATE = 'create'

async function ask<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error ?? 'That did not work')
  return json as T
}

export default function DriveFolderCard() {
  const [state, setState] = useState<RootState | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [choice, setChoice] = useState<Choice>({})
  const [busy, setBusy] = useState<string | null>(null)

  // spelled out in full: the bundler replaces this exact text, so a lookup
  // through a variable would come out undefined in the browser
  const pickerKey = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY
  const appId = process.env.NEXT_PUBLIC_GOOGLE_PICKER_APP_ID

  const load = useCallback(() => {
    ask<RootState>('/api/gdrive/root')
      .then(setState)
      .catch(() => setState({ configured: false, connected: false, account_email: null, picked: null }))
  }, [])

  useEffect(() => { load() }, [load])

  const loadPlan = useCallback(async (createClientsFolder?: boolean) => {
    setBusy('plan')
    try {
      const next = createClientsFolder
        ? await ask<Plan>('/api/gdrive/root/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ create_clients_folder: true }),
        })
        : await ask<Plan>('/api/gdrive/root/plan')
      setPlan(next)
      setChoice(Object.fromEntries(next.rows.map(r => [r.client_id, r.folder_id ?? CREATE])))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The folders could not be read')
    } finally {
      setBusy(null)
    }
  }, [])

  /** Open Google's own folder chooser. */
  async function choose() {
    if (!pickerKey) return
    setBusy('pick')
    try {
      const { token } = await ask<{ token: string }>('/api/gdrive/root/token')
      await loadPickerScript()
      const picker = window.google?.picker
      if (!picker) throw new Error('chooser unavailable')

      const mine = new picker.DocsView(picker.ViewId.FOLDERS)
        .setSelectFolderEnabled(true)
        .setIncludeFolders(true)
        .setMimeTypes('application/vnd.google-apps.folder')
      // folders somebody else owns and shared with this account — which is
      // exactly where a team's HQ folder usually lives
      const shared = new picker.DocsView(picker.ViewId.FOLDERS)
        .setSelectFolderEnabled(true)
        .setIncludeFolders(true)
        .setOwnedByMe(false)
        .setMimeTypes('application/vnd.google-apps.folder')

      let builder = new picker.PickerBuilder()
        .setOAuthToken(token)
        .setDeveloperKey(pickerKey)
        .addView(mine)
        .addView(shared)
        .setTitle('Choose the folder our client work lives in')
        .enableFeature(picker.Feature.SUPPORT_DRIVES)
      // the app id is what ties the "you may use this folder" grant to this
      // app; without it the chooser still works but the grant can be dropped
      if (appId) builder = builder.setAppId(appId)

      builder
        .setCallback((data: PickerData) => {
          if (data.action !== picker.Action.PICKED) return
          const doc = data.docs?.[0]
          if (!doc?.id) return
          void save(doc.id, doc.name ?? '')
        })
        .build()
        .setVisible(true)
    } catch (e) {
      toast.error(e instanceof Error && e.message !== 'chooser unavailable'
        ? e.message
        : 'The Google folder chooser could not be opened. Try again in a moment.')
    } finally {
      setBusy(null)
    }
  }

  async function save(id: string, name: string) {
    setBusy('pick')
    try {
      const saved = await ask<{ name: string }>('/api/gdrive/root/pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name }),
      })
      toast.success(`Files will go in “${saved.name}”`)
      setPlan(null)
      load()
      void loadPlan()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That folder could not be saved')
    } finally {
      setBusy(null)
    }
  }

  async function apply() {
    if (!plan) return
    const rows = plan.rows
      .filter(r => r.action !== 'linked' || choice[r.client_id] !== r.folder_id)
      .map(r => {
        const pick = choice[r.client_id]
        return pick === CREATE
          ? { client_id: r.client_id, create: true }
          : { client_id: r.client_id, folder_id: pick }
      })
    if (rows.length === 0) {
      toast.success('Every client already points at a folder')
      return
    }
    setBusy('apply')
    try {
      const result = await ask<{ linked: number; created: number; skipped: { why: string }[] }>(
        '/api/gdrive/root/apply',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows }),
        },
      )
      const parts = [
        result.linked ? `${result.linked} matched up` : '',
        result.created ? `${result.created} new folder${result.created === 1 ? '' : 's'} made` : '',
      ].filter(Boolean)
      toast.success(parts.length ? `Saved — ${parts.join(', ')}` : 'Nothing needed changing')
      if (result.skipped.length) {
        toast.error(`${result.skipped.length} could not be saved: ${result.skipped[0].why}`)
      }
      void loadPlan()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That could not be saved')
    } finally {
      setBusy(null)
    }
  }

  if (!state) return <Skeleton className="h-40 w-full" />
  if (!state.configured) return null

  const picked = state.picked

  return (
    <Card className="border-border bg-surface">
      <CardHeader>
        <CardTitle>Where the files go</CardTitle>
        <CardDescription>
          One folder in Google Drive holds every client’s work. Point this at the
          folder the team already uses, and new shoots file themselves into it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!state.connected && (
          <p className="text-body-15 text-muted-foreground">
            Connect Google Drive above first.
          </p>
        )}

        {state.connected && !pickerKey && (
          <p className="text-body-15 text-muted-foreground">
            Ask the admin to add the Google Picker key, then this button will work.
          </p>
        )}

        {state.connected && (
          <div className="flex flex-wrap items-center gap-3">
            <FolderOpen className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-body-15 font-medium text-foreground">
                {picked ? picked.name : 'No folder chosen yet'}
              </p>
              <p className="text-body-15 text-muted-foreground">
                {picked
                  ? picked.owner_email
                    ? `Owned by ${picked.owner_email}`
                    : 'Shared folder'
                  : 'Files have nowhere to go until you choose one.'}
              </p>
            </div>
            <Button
              size="sm"
              variant={picked ? 'outline' : 'default'}
              disabled={!pickerKey || busy === 'pick'}
              onClick={() => void choose()}
            >
              {busy === 'pick' ? 'Opening…' : picked ? 'Change folder' : 'Choose folder'}
            </Button>
            {picked && !plan && (
              <Button
                size="sm" variant="outline"
                disabled={busy === 'plan'}
                onClick={() => void loadPlan()}
              >
                {busy === 'plan' ? 'Reading…' : 'Check the client folders'}
              </Button>
            )}
          </div>
        )}

        {plan?.needs_clients_folder && (
          <div className="rounded-lg border border-border bg-background p-4">
            <p className="text-body-15 text-foreground">
              There is no folder called “Clients” inside “{plan.root.name}”.
            </p>
            <p className="mt-1 text-body-15 text-muted-foreground">
              Every client folder goes in there. Nothing is made until you say so.
            </p>
            <Button
              className="mt-3" size="sm"
              disabled={busy === 'plan'}
              onClick={() => void loadPlan(true)}
            >
              {busy === 'plan' ? 'Making it…' : 'Make the Clients folder'}
            </Button>
          </div>
        )}

        {plan && !plan.needs_clients_folder && (
          <div className="flex flex-col gap-3">
            <p className="text-body-15 text-foreground">
              Matched {plan.matched} of {plan.total} clients
              {plan.to_create > 0
                ? ` — ${plan.to_create} folder${plan.to_create === 1 ? '' : 's'} will be made`
                : ' — nothing new to make'}.
            </p>

            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {plan.rows.map(row => {
                const pick = choice[row.client_id] ?? CREATE
                return (
                  <li
                    key={row.client_id}
                    className="flex flex-wrap items-center gap-3 p-3"
                  >
                    <span className="min-w-0 flex-1 text-body-15 text-foreground">
                      {row.client_name}
                      {row.confidence === 'likely' && pick === row.folder_id && (
                        <span className="ml-2 rounded-full bg-accent-amber/15 px-2 py-0.5 text-secondary-13 text-foreground">
                          worth a check
                        </span>
                      )}
                      {row.action === 'linked' && pick === row.folder_id && (
                        <span className="ml-2 rounded-full bg-accent-green/15 px-2 py-0.5 text-secondary-13 text-foreground">
                          already set
                        </span>
                      )}
                    </span>
                    <label className="sr-only" htmlFor={`folder-${row.client_id}`}>
                      Folder for {row.client_name}
                    </label>
                    <select
                      id={`folder-${row.client_id}`}
                      className="min-h-11 w-full max-w-xs rounded-lg border border-border bg-background px-3 text-body-15 text-foreground sm:w-auto"
                      value={pick}
                      onChange={e =>
                        setChoice(c => ({ ...c, [row.client_id]: e.target.value }))}
                    >
                      <option value={CREATE}>Make a new folder</option>
                      {plan.folders.map(f => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  </li>
                )
              })}
            </ul>

            {plan.extra.length > 0 && (
              <p className="text-body-15 text-muted-foreground">
                {plan.extra.length} folder{plan.extra.length === 1 ? '' : 's'} in there
                {plan.extra.length === 1 ? ' belongs' : ' belong'} to no client on this
                list — {plan.extra.slice(0, 4).map(f => f.name).join(', ')}
                {plan.extra.length > 4 ? '…' : ''}. They are left alone.
              </p>
            )}

            <div className="flex flex-wrap gap-3">
              <Button disabled={busy === 'apply'} onClick={() => void apply()}>
                {busy === 'apply' ? 'Saving…' : 'Save these folders'}
              </Button>
              <Button
                variant="ghost" disabled={busy === 'plan'}
                onClick={() => { setPlan(null) }}
              >
                Not now
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
