'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, MapPin, Plus, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SocialAccount } from '@/lib/db-types'
import {
  readAudioChoice, readCarouselCards, readPoll, readUserTags, PAGE_ID_HELP,
  type ChannelExtras, type ComposerState, type MoreOption, type OptionChoice, type SavedLocation,
} from '@/app/lib/schedule-compose-core'
import {
  isOrganizationUrn, isPageId, networkName,
  DEFAULT_POLL_DURATION, POLL_DURATION_LABELS, POLL_DURATIONS, POLL_OPTIONS_MAX,
  POLL_OPTIONS_MIN, POLL_QUESTION_MAX, POLL_OPTION_MAX,
  TIKTOK_CONSENT_LINE, type FacebookCarouselCard, type InstagramAudio, type PollDuration,
} from '@/app/lib/publish-core'
import type { ChannelOptions, InstagramAudioTrack } from '@/app/lib/publisher'
import { Thumb } from './tiles'

/**
 * THE POST WINDOW'S OPTION ROWS — the per-network settings under "More
 * options", and the two small menus the window's top row uses. Moved out of
 * the old NewPostDialog unchanged when it became PostWindow (29 Sep 2026), so
 * the window file is the window and this file is the settings.
 */

/**
 * A pill that opens a small panel under it.
 *
 * Its own container, its own outside-click: the whole set used to share one
 * ref pointing at the dialog card, so clicking the caption box left the
 * channel list hanging open over the words being typed.
 */
export function Dropdown({ label, width, closeOnPick = true, disabled = false, tour, children }: {
  label: React.ReactNode
  width: number
  /** the `data-tour` key the walkthrough points at, when it points here */
  tour?: string
  /** a booked or posted post keeps its type — the menu shows it, and opens nothing */
  disabled?: boolean
  /**
   * Does clicking inside the panel finish the job?
   *
   * True for the post-type menu — one choice and you are done. FALSE for the
   * channels list, which is a MULTI-SELECT with tick marks: closing it on the
   * first tick means reopening the pill for every extra account, which is
   * what happened when all the panels were given one shared close.
   */
  closeOnPick?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc, true)
    }
  }, [open])

  return (
    <div ref={box} data-tour={tour} className="relative">
      <button
        type="button"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-paper px-3 text-[13px] font-semibold hover:bg-muted disabled:opacity-70 disabled:hover:bg-paper"
      >
        {label}
        <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      </button>
      {open && (
        <div
          style={{ width }}
          onClick={closeOnPick ? () => setOpen(false) : undefined}
          className="absolute left-0 top-[calc(100%+6px)] z-50 rounded-inner border border-border bg-popover p-1.5 shadow-lg"
        >
          {children}
        </div>
      )}
    </div>
  )
}

export function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 w-full items-center rounded-tile px-2 text-left text-[13px] hover:bg-muted"
    >
      {children}
    </button>
  )
}

/**
 * One row of "More options", for the channels it actually applies to.
 *
 * ONE renderer for every setting, driven by the table in
 * `schedule-compose-core`: a row is a control kind, a label and the one field
 * it writes. Adding a posting option is a line in that table, not another
 * branch here — which is what keeps the window and the provider in step.
 *
 * Two rows are their own shape. LOCATION, because Instagram takes a numeric
 * Facebook Page id and there is no place search anywhere in the chain, so the
 * row offers the client's saved places first and a box for the number second.
 * And CONSENT, because it is not a setting with a default — it is a statement
 * somebody makes, once per post, and TikTok will not take the post without it.
 */
export function ExtraRow({ option, channels, state, dispatch, locations, lists }: {
  option: MoreOption
  channels: SocialAccount[]
  state: ComposerState
  dispatch: (a: { type: 'extra'; channel: string; patch: ChannelExtras }) => void
  locations: SavedLocation[]
  /** the per-account lists fetched from the network, by account id */
  lists: Record<string, ChannelOptions>
}) {
  const first = channels[0]
  const value = first ? state.perChannel[first.id] ?? {} : {}
  const held = (value as Record<string, unknown>)[option.field]
  const [open, setOpen] = useState(held !== undefined && held !== '')
  if (!first) return null

  /** every channel this row covers gets the same answer: one Instagram
   *  account per client is the case that exists, and two would want two rows
   *  — the same per-channel question the one-caption-for-all decision parked */
  const applyAll = (patch: ChannelExtras) => {
    for (const c of channels) dispatch({ type: 'extra', channel: c.id, patch })
  }
  const set = (v: unknown) => applyAll({ [option.field]: v } as ChannelExtras)

  const help = option.help
    ? <p className="text-[12px] text-muted-foreground">{option.help}</p>
    : null
  const field = 'min-h-11 w-full rounded-full border border-border bg-surface px-3 text-[13px]'

  /* ── a tick box: on, off, and what the ACCOUNT does untouched ── */
  if (option.control === 'toggle') {
    // what the ACCOUNT does untouched beats what the network does untouched:
    // a TikTok creator whose own answer to "allow duets" is no must not see a
    // ticked box, and one whose account will not let it be changed at all
    // must not be able to change it here either
    const account = lists[first.id]?.interactions as Record<string, boolean> | null | undefined
    const rules = lists[first.id]?.interactionRules as
      Record<string, { enabled: boolean; required: boolean; label: string }> | null | undefined
    const seeded = account?.[option.field as string]
    const rule = rules?.[option.field as string]
    const locked = rule ? rule.enabled === false : false
    const value = locked
      ? (seeded ?? false)
      : held === undefined ? (seeded ?? Boolean(option.defaultOn)) : Boolean(held)
    return (
      <div className="flex flex-col gap-1">
        <label className={cn(
          'flex min-h-11 items-center gap-2.5 text-[14px] font-medium',
          locked && 'text-muted-foreground',
        )}>
          <input
            type="checkbox"
            checked={value}
            disabled={locked}
            onChange={e => set(e.target.checked)}
            className="h-4 w-4"
          />
          {option.label}
        </label>
        {locked && (
          <p className="text-[12px] text-muted-foreground">
            {`This account does not let “${rule?.label ?? option.label}” be changed.`}
          </p>
        )}
        {help}
      </div>
    )
  }

  /* ── TikTok's one tick, which a post cannot go out without ── */
  if (option.control === 'consent') {
    const given = Boolean(held)
    return (
      <div className={cn(
        'flex flex-col gap-1.5 rounded-inner border p-3',
        given ? 'border-border' : 'border-accent-amber/50 bg-tint-amber',
      )}>
        <p className="text-[12px] leading-[1.45]">{TIKTOK_CONSENT_LINE}</p>
        <label className="flex min-h-11 items-center gap-2.5 text-[14px] font-medium">
          <input
            type="checkbox"
            checked={given}
            onChange={e => set(e.target.checked || undefined)}
            className="h-4 w-4"
          />
          {option.label}
        </label>
      </div>
    )
  }

  /* ── a menu: the network's own list where there is one ── */
  if (option.control === 'select') {
    const fetched: OptionChoice[] = option.source
      ? (lists[first.id]?.[option.source] ?? [])
      : []
    const choices = fetched.length > 0 ? fetched : option.choices ?? []
    const current = held === undefined ? '' : String(held)
    // a list we could not read is a box to type in, not a menu with nothing
    // in it: a LinkedIn company page nobody can pick is a post that cannot go
    // out as the company
    if (choices.length === 0) {
      return (
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-muted-foreground">{option.label}</span>
          <input
            value={current}
            onChange={e => set(e.target.value.trim() || undefined)}
            placeholder={option.placeholder ?? 'Paste the id'}
            className={field}
          />
          <p className="text-[12px] text-muted-foreground">
            {`We could not read this list from ${networkName(String(first.platform))} just now. `}
            Leave it empty and the network decides.
          </p>
        </div>
      )
    }
    const hasBlank = choices.some(c => c.value === '')
    return (
      <div className="flex flex-col gap-1.5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-muted-foreground">{option.label}</span>
          <select
            value={choices.some(c => c.value === current) ? current : ''}
            onChange={e => set(e.target.value || undefined)}
            className={field}
          >
            {!hasBlank && <option value="">Leave it to the network</option>}
            {choices.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        {help}
      </div>
    )
  }

  /* ── the place a post is tagged to ── */
  if (option.control === 'location') {
    const id = String(value.locationId ?? '')
    const bad = id !== '' && !isPageId(id)
    return (
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex min-h-11 items-center gap-2.5 text-left text-[14px] font-medium"
        >
          <MapPin className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden />
          {option.label}
          {id && !bad && (
            <span className="text-[12px] font-normal text-muted-foreground">
              — {locations.find(l => l.pageId === id)?.name ?? id}
            </span>
          )}
        </button>
        {open && (
          <div className="flex flex-col gap-1.5">
            {locations.length > 0 && (
              <select
                value={locations.some(l => l.pageId === id) ? id : ''}
                onChange={e => set(e.target.value || undefined)}
                className={field}
              >
                <option value="">No place</option>
                {locations.map(l => (
                  <option key={l.pageId} value={l.pageId}>{l.name}</option>
                ))}
              </select>
            )}
            <input
              value={id}
              inputMode="numeric"
              onChange={e => set(e.target.value.trim() || undefined)}
              placeholder="…or paste a Facebook Page ID"
              className={field}
            />
            <p className={cn('text-[12px]', bad ? 'font-medium text-accent-red-deep' : 'text-muted-foreground')}>
              {bad
                ? 'That does not look like a Page ID — it is a long number, not the @name.'
                : locations.length > 0
                  ? `Saved places come from this client's Social page. ${PAGE_ID_HELP}`
                  : `No places saved for this client yet. ${PAGE_ID_HELP}`}
            </p>
          </div>
        )}
      </div>
    )
  }

  /* ── a song out of Instagram's own catalogue ── */
  if (option.control === 'music') {
    return (
      <MusicRow
        option={option}
        accountId={first.id}
        chosenTrack={readAudioChoice(held)}
        open={open}
        onToggle={() => setOpen(o => !o)}
        onChange={track => set(track ?? undefined)}
      />
    )
  }

  /* ── a question with two to four answers, instead of a post ── */
  if (option.control === 'poll') {
    // what is typed is kept as typed: trimming and dropping blanks on every
    // keystroke ate trailing spaces and moved answers between boxes (review,
    // 10 Sep 2026) — the stored poll is cleaned by `readPoll` when it is read
    const raw = (held && typeof held === 'object' ? held : null) as { question?: string; options?: string[]; duration?: PollDuration } | null
    const poll = { question: String(raw?.question ?? ''), options: Array.isArray(raw?.options) ? raw!.options!.map(String) : ['', ''], duration: raw?.duration }
    const answers = poll.options.length >= POLL_OPTIONS_MIN
      ? poll.options
      : [...poll.options, ...Array(POLL_OPTIONS_MIN - poll.options.length).fill('')]
    const write = (next: { question?: string; options?: string[]; duration?: PollDuration }) => {
      const question = next.question ?? poll.question
      const options = next.options ?? answers
      const duration = next.duration ?? poll.duration
      set(question.trim() || options.some(o => o.trim())
        ? { question, options, ...(duration ? { duration } : {}) }
        : undefined)
    }
    return (
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex min-h-11 items-center gap-2.5 text-left text-[14px] font-medium"
        >
          <Plus className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden />
          {option.label}
          {!open && poll.question && (
            <span className="truncate text-[12px] font-normal text-muted-foreground">
              — {poll.question}
            </span>
          )}
        </button>
        {open && (
          <div className="flex flex-col gap-1.5">
            <input
              value={poll.question}
              maxLength={POLL_QUESTION_MAX}
              onChange={e => write({ question: e.target.value })}
              placeholder="What are you asking?"
              className={field}
            />
            {answers.map((answer, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  value={answer}
                  maxLength={POLL_OPTION_MAX}
                  onChange={e => write({
                    options: answers.map((a, at) => (at === i ? e.target.value : a)),
                  })}
                  placeholder={`Answer ${i + 1}`}
                  className={field}
                />
                {answers.length > POLL_OPTIONS_MIN && (
                  <button
                    type="button"
                    aria-label={`Take answer ${i + 1} off`}
                    onClick={() => write({ options: answers.filter((_, at) => at !== i) })}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-muted"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
                  </button>
                )}
              </div>
            ))}
            {answers.length < POLL_OPTIONS_MAX && (
              <button
                type="button"
                onClick={() => write({ options: [...answers, ''] })}
                className="flex min-h-9 w-fit items-center gap-1.5 rounded-full border border-border px-3 text-[12px] font-semibold hover:bg-muted"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
                Add an answer
              </button>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-semibold text-muted-foreground">
                How long it runs
              </span>
              <select
                value={poll.duration ?? DEFAULT_POLL_DURATION}
                onChange={e => write({ duration: e.target.value as PollDuration })}
                className={field}
              >
                {POLL_DURATIONS.map(d => (
                  <option key={d} value={d}>{POLL_DURATION_LABELS[d]}</option>
                ))}
              </select>
            </label>
            {help}
          </div>
        )}
      </div>
    )
  }

  /* ── a link under each picture: Facebook's clickable carousel ── */
  if (option.control === 'cards') {
    const pictures = state.slides.filter(sl => sl.type !== 'video')
    const cards = readCarouselCards(held)
    const write = (index: number, patch: Partial<FacebookCarouselCard>) => {
      const next: FacebookCarouselCard[] = pictures.map((_, i) => {
        const card: FacebookCarouselCard = cards[i] ?? { link: '' }
        return i === index ? { ...card, ...patch } : card
      })
      const kept = next.filter(c => c.link.trim() || c.name?.trim() || c.description?.trim())
      set(kept.length > 0 ? next : undefined)
    }
    return (
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex min-h-11 items-center gap-2.5 text-left text-[14px] font-medium"
        >
          <Plus className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden />
          {option.label}
          {!open && cards.length > 0 && (
            <span className="text-[12px] font-normal text-muted-foreground">
              — {cards.length} of {pictures.length}
            </span>
          )}
        </button>
        {open && (
          <div className="flex flex-col gap-2.5">
            {pictures.length === 0 && (
              <p className="text-[12px] text-muted-foreground">
                Add the pictures first. Each one gets its own link.
              </p>
            )}
            {pictures.map((picture, i) => (
              <div key={`${picture.url}-${i}`} className="flex gap-2">
                <div className="h-[52px] w-[42px] shrink-0 overflow-hidden rounded-tile bg-foreground/[0.06]">
                  <Thumb slide={picture} label={`Picture ${i + 1}`} className="h-full w-full" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <input
                    value={cards[i]?.link ?? ''}
                    onChange={e => write(i, { link: e.target.value.trim() })}
                    placeholder={`Where picture ${i + 1} goes: https://…`}
                    className={field}
                  />
                  <input
                    value={cards[i]?.name ?? ''}
                    onChange={e => write(i, { name: e.target.value })}
                    placeholder="Headline"
                    className={field}
                  />
                  <input
                    value={cards[i]?.description ?? ''}
                    onChange={e => write(i, { description: e.target.value })}
                    placeholder="A line under it"
                    className={field}
                  />
                </div>
              </div>
            ))}
            {help}
          </div>
        )}
      </div>
    )
  }

  /* ── a list of words: tags, collaborators ── */
  if (option.control === 'tags' || option.control === 'collaborators') {
    return (
      <ListRow
        option={option}
        value={Array.isArray(held) ? held as string[] : []}
        open={open}
        onToggle={() => setOpen(o => !o)}
        onChange={list => set(list.length > 0 ? list : undefined)}
      />
    )
  }
  /* ── people tagged in the post: typed as names, stored as tags ── */
  if (option.control === 'people') {
    const names = readUserTags(held).map(t => t.username)
    return (
      <ListRow
        option={option}
        value={names}
        open={open}
        onToggle={() => setOpen(o => !o)}
        onChange={list => set(list.length > 0 ? readUserTags(list) : undefined)}
      />
    )
  }

  /* ── everything else typed: one line, several lines, or a moment ── */
  const shown = option.control === 'seconds'
    ? (typeof held === 'number' ? String(Math.round(held / 100) / 10) : '')
    : String(held ?? '')

  const badUrn = option.field === 'organizationUrn' && shown !== '' && !isOrganizationUrn(shown)

  const write = (raw: string) => {
    if (option.control === 'seconds') {
      const seconds = Number(raw)
      set(raw.trim() && Number.isFinite(seconds) && seconds >= 0
        ? Math.round(seconds * 1000) : undefined)
      return
    }
    set(raw || undefined)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex min-h-11 items-center gap-2.5 text-left text-[14px] font-medium"
      >
        <Plus className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden />
        {option.label}
        {!open && shown && (
          <span className="truncate text-[12px] font-normal text-muted-foreground">— {shown}</span>
        )}
      </button>
      {open && (
        <>
          {option.control === 'longText' ? (
            <textarea
              value={shown}
              rows={3}
              onChange={e => write(e.target.value)}
              placeholder={option.placeholder}
              className="w-full resize-y rounded-inner border border-border bg-surface px-3 py-2 text-[13px]"
            />
          ) : (
            <input
              value={shown}
              inputMode={option.control === 'seconds' ? 'decimal' : undefined}
              onChange={e => write(e.target.value)}
              placeholder={option.control === 'seconds' ? 'Seconds in — for example 2.5' : option.placeholder}
              className={field}
            />
          )}
          {badUrn && (
            <p role="alert" className="text-[12px] font-medium text-accent-red-deep">
              That does not look like a company page — pick one from the list, or paste
              its id, a plain number.
            </p>
          )}
          {help}
        </>
      )}
    </div>
  )
}

/** A track's length as a person reads it: 3:04. */
function trackLength(ms: number | null): string {
  if (!ms || ms <= 0) return ''
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * INSTAGRAM'S OWN MUSIC, searched from inside the post.
 *
 * The id is Meta's and cannot be invented, so this searches and offers what
 * comes back and nothing else. The one failure worth a sentence is the
 * account being connected the classic way: Meta serves the catalogue only to
 * Instagram accounts connected through Facebook, and an empty list would read
 * as "no songs called that" while somebody searched again and again.
 *
 * The two volumes are Instagram's: the track, and how much of the video's own
 * sound stays under it. Untouched, Instagram uses 100 for both, so nothing is
 * sent until somebody moves one.
 */
function MusicRow({ option, accountId, chosenTrack, open, onToggle, onChange }: {
  option: MoreOption
  accountId: string
  chosenTrack: InstagramAudio | null
  open: boolean
  onToggle: () => void
  onChange: (track: InstagramAudio | null) => void
}) {
  const [query, setQuery] = useState('')
  const [tracks, setTracks] = useState<InstagramAudioTrack[]>([])
  const [searching, setSearching] = useState(false)
  const [needsFacebook, setNeedsFacebook] = useState(false)
  const [searched, setSearched] = useState(false)
  const field = 'min-h-11 w-full rounded-full border border-border bg-surface px-3 text-[13px]'

  const search = () => {
    setSearching(true)
    setSearched(true)
    fetch(`/api/social/schedule/audio?accountId=${encodeURIComponent(accountId)}`
      + `&audioType=music&q=${encodeURIComponent(query.trim())}`)
      .then(r => (r.ok ? r.json() : null))
      .then((json: { tracks?: InstagramAudioTrack[]; needsFacebookLogin?: boolean } | null) => {
        setTracks(json?.tracks ?? [])
        setNeedsFacebook(json?.needsFacebookLogin === true)
      })
      .catch(() => { setTracks([]); setNeedsFacebook(false) })
      .finally(() => setSearching(false))
  }

  const volume = (which: 'audioVolume' | 'videoVolume', raw: string) => {
    if (!chosenTrack) return
    const value = Number(raw)
    onChange({
      ...chosenTrack,
      [which]: raw.trim() && Number.isFinite(value)
        ? Math.min(100, Math.max(0, Math.round(value)))
        : undefined,
    })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-h-11 items-center gap-2.5 text-left text-[14px] font-medium"
      >
        <Plus className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden />
        {option.label}
        {!open && chosenTrack && (
          <span className="truncate text-[12px] font-normal text-muted-foreground">
            — {chosenTrack.title}
          </span>
        )}
      </button>
      {open && (
        <div className="flex flex-col gap-1.5">
          {chosenTrack ? (
            <div className="flex flex-col gap-2 rounded-inner border border-border p-2.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                  {chosenTrack.title}
                  {chosenTrack.artist && (
                    <span className="font-normal text-muted-foreground"> · {chosenTrack.artist}</span>
                  )}
                </span>
                <button
                  type="button"
                  aria-label="Take the music off"
                  onClick={() => onChange(null)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-muted"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {([
                  ['audioVolume', 'Track volume'],
                  ['videoVolume', 'Video sound'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    {label}
                    <input
                      value={chosenTrack[key] === undefined ? '' : String(chosenTrack[key])}
                      inputMode="numeric"
                      onChange={e => volume(key, e.target.value)}
                      placeholder="100"
                      className="min-h-9 w-16 rounded-full border border-border bg-surface px-2.5 text-center text-[13px] text-foreground"
                    />
                  </label>
                ))}
              </div>
              <p className="text-[12px] text-muted-foreground">
                0 to 100 each. Leave them empty and Instagram plays both at full.
              </p>
            </div>
          ) : (
            <>
              <div className="flex gap-1.5">
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search() } }}
                  placeholder={option.placeholder ?? 'Search for a song'}
                  className={field}
                />
                <button
                  type="button"
                  onClick={search}
                  disabled={searching}
                  className="min-h-11 shrink-0 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-50"
                >
                  {searching ? 'Looking' : 'Search'}
                </button>
              </div>
              {needsFacebook ? (
                <p className="rounded-inner border border-accent-amber/50 bg-tint-amber px-3 py-2 text-[12px] font-medium">
                  Music needs this Instagram account reconnected through Facebook. Use the
                  connect link and pick Facebook Login.
                </p>
              ) : tracks.length > 0 ? (
                <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
                  {tracks.map(track => (
                    <li key={track.audioId}>
                      <button
                        type="button"
                        onClick={() => onChange({
                          audioId: track.audioId,
                          title: track.title,
                          ...(track.artist ? { artist: track.artist } : {}),
                        })}
                        className="flex w-full min-h-11 items-center gap-2 rounded-inner px-2 text-left hover:bg-muted"
                      >
                        <span className="min-w-0 flex-1 truncate text-[13px]">
                          {track.title}
                          {track.artist && (
                            <span className="text-muted-foreground"> · {track.artist}</span>
                          )}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {trackLength(track.durationMs)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : searched && !searching ? (
                <p className="text-[12px] text-muted-foreground">
                  Nothing came back for that. Try fewer words, or the artist’s name.
                </p>
              ) : (
                <p className="text-[12px] text-muted-foreground">
                  Search Instagram’s catalogue, or press Search on an empty box for what is
                  trending.
                </p>
              )}
            </>
          )}
          {option.help && <p className="text-[12px] text-muted-foreground">{option.help}</p>}
        </div>
      )}
    </div>
  )
}

/**
 * A list of short words — YouTube's tags, Instagram's collaborators.
 *
 * IT HOLDS WHAT WAS TYPED, not what has been parsed. The first version
 * rendered the parsed array joined with commas on every keystroke, so typing
 * a comma produced a list of one, which rendered back without the comma — the
 * separator was erased by the keystroke that typed it, and a second tag could
 * never be started. The raw string lives here; a comma, Enter or leaving the
 * box is what commits it.
 */
function ListRow({ option, value, open, onToggle, onChange }: {
  option: MoreOption
  value: string[]
  open: boolean
  onToggle: () => void
  onChange: (list: string[]) => void
}) {
  const [raw, setRaw] = useState<string | null>(null)
  const shown = raw ?? value.join(', ')
  const max = option.control === 'collaborators' ? 3 : 50

  const commit = (text: string) => {
    const list: string[] = []
    for (const part of text.split(',')) {
      const word = part.trim().replace(/^@/, '')
      if (word && !list.includes(word)) list.push(word)
    }
    const capped = list.slice(0, max)
    setRaw(null)
    onChange(capped)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-h-11 items-center gap-2.5 text-left text-[14px] font-medium"
      >
        <Plus className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden />
        {option.label}
        {!open && value.length > 0 && (
          <span className="truncate text-[12px] font-normal text-muted-foreground">
            — {value.join(', ')}
          </span>
        )}
      </button>
      {open && (
        <>
          {value.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {value.map(word => (
                <span
                  key={word}
                  className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[12px] font-medium"
                >
                  {word}
                  <button
                    type="button"
                    aria-label={`Take ${word} off`}
                    onClick={() => onChange(value.filter(w => w !== word))}
                    className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-muted"
                  >
                    <X className="h-3 w-3" strokeWidth={2.2} aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            value={shown}
            onChange={e => {
              // a comma is what finishes a word, so it commits rather than
              // waiting for the box to be left
              if (e.target.value.endsWith(',')) { commit(e.target.value); return }
              setRaw(e.target.value)
            }}
            onKeyDown={e => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              commit(shown)
            }}
            onBlur={() => commit(shown)}
            placeholder={option.placeholder}
            className="min-h-11 w-full rounded-full border border-border bg-surface px-3 text-[13px]"
          />
          {option.help && <p className="text-[12px] text-muted-foreground">{option.help}</p>}
        </>
      )}
    </div>
  )
}
