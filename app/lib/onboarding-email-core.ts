/**
 * THE WELCOME EMAIL A NEW CLIENT GETS AFTER THEIR AGREEMENT IS SIGNED (info@, 4 Nov 2026: "I like this layout — after
 * the agreement has been signed they get sent this and their portal"; the owner, 13 Nov 2026: "create an onboarding
 * tab under client, ensure AM or super admins can access and create that, and include the layout build").
 *
 * Pure: what the email holds, a sensible first draft built from what the client's record already says, a tidy-up of
 * whatever a browser sends back. No I/O. The look is the React Email template, app/emails/OnboardingEmail.tsx. Sending is NOT here and not built: the client is never emailed
 * by the app without the owner's say (mailer.ts, 13 Sep 2026).
 */

export type OnboardingRow = { label: string; value: string }
export type OnboardingStep = { title: string; body: string }

export type OnboardingDraft = {
  subject: string
  greeting: string
  intro: string
  agreedTitle: string
  agreed: OnboardingRow[]
  workTitle: string
  workHeadline: string
  workBody: string
  seeTitle: string
  seeIntro: string
  see: OnboardingStep[]
  portalTitle: string
  portalBody: string
  portalButton: string
  needTitle: string
  needBody: string
  /** the button under "what we still need": it opens the portal's Brand assets tab, where the client adds the files */
  needButton: string
  callTitle: string
  callBody: string
  callButton: string
  callUrl: string
  nextTitle: string
  next: OnboardingStep[]
  signoff: string
  signature: string
}

export const ONBOARDING_LIMITS = { rows: 12, steps: 8, short: 140, long: 1200 } as const

const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? ''

/** "8 reels and 20 graphics" */
export function joinWords(parts: string[]): string {
  const p = parts.filter(Boolean)
  if (p.length <= 1) return p[0] ?? ''
  return `${p.slice(0, -1).join(', ')} and ${p[p.length - 1]}`
}

/** "2026-11-20" → "20 November 2026"; anything else → '' */
export function plainDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''))
  if (!m) return ''
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const month = months[Number(m[2]) - 1]
  return month ? `${Number(m[3])} ${month} ${m[1]}` : ''
}

/**
 * The first draft, written from the client's own record so the account manager edits rather than starts from a blank
 * page. Only what the record really says goes in "What we agreed": no deliverables on file → no deliverables row.
 */
export function defaultOnboarding(input: {
  clientName: string
  contactName?: string | null
  lines?: { label: string; monthly_qty: number }[]
  services?: { label: string; active: boolean }[]
  startDate?: string | null
  managerName?: string | null
}): OnboardingDraft {
  const who = firstName(input.contactName ?? '') || input.clientName.trim() || 'there'
  const lines = (input.lines ?? []).filter(l => l.monthly_qty > 0)
  const services = (input.services ?? []).filter(s => s.active)
  const agreed: OnboardingRow[] = []
  if (lines.length) agreed.push({ label: 'Each month', value: `${joinWords(lines.map(l => `${l.monthly_qty} ${l.label.toLowerCase()}`))}.` })
  if (services.length) agreed.push({ label: 'Also included', value: `${joinWords(services.map(s => s.label))}.` })
  const start = plainDate(input.startDate)
  if (start) agreed.push({ label: 'Start date', value: start })
  agreed.push({ label: 'Approvals', value: 'Nothing is posted without your yes. You approve each post in your portal.' })
  if (input.managerName?.trim()) agreed.push({ label: 'Your account manager', value: input.managerName.trim() })
  return {
    subject: `Welcome to MD Media, ${who}`,
    greeting: `Hi ${who},`,
    intro: 'Welcome to MD Media, and thank you for signing your agreement. Here is what we agreed, how we will work together and what happens next.',
    agreedTitle: 'What we agreed',
    agreed,
    workTitle: 'How we work',
    workHeadline: 'You see it before it goes out',
    workBody: 'We plan your content a month ahead, shoot it, edit it and send each post to you for approval. If something is not right, tell us on the post and we change it.',
    seeTitle: 'What you will see',
    seeIntro: 'Your portal, one page for everything, on your phone or laptop.',
    // the portal's own four tabs, in the order the client meets them (the owner, 13 Nov 2026: "this should be the
    // portal screenshots: shoot briefs, editing and designing content, and the scheduling where they can approve")
    see: [
      { title: 'Shoot brief', body: 'The plan for each shoot: what we are filming, where and when. Read it and tell us if anything should change.' },
      { title: 'Editing', body: 'Your videos as they are edited. Watch each one, approve it or ask for a change.' },
      { title: 'Designing', body: 'Your graphics and carousels. Approve each design or leave a note on it.' },
      { title: 'Scheduling', body: 'Every post with its caption and date. Approve it and we book it; nothing goes out without your yes.' },
    ],
    portalTitle: 'Your portal',
    portalBody: 'Your posts will appear here as they are ready. Save this link, there is no password.',
    portalButton: 'Open your portal',
    needTitle: 'A few things we still need',
    needBody: 'Your logo files, brand colours and fonts, logins for your social accounts, and any dates we should plan around.\n\nAdd your brand files in your portal, and reply to this email with the rest, whenever suits.',
    needButton: 'Add your brand files',
    callTitle: 'A set-up call',
    callBody: 'Prefer to talk it through first? We are happy to set up a short call.',
    callButton: 'Book a call',
    callUrl: '',
    nextTitle: 'What happens next',
    next: [
      { title: 'We plan your first month', body: 'A content plan built on your brand and your goals.' },
      { title: 'We shoot and edit', body: 'We book the shoot with you and turn it into finished posts.' },
      { title: 'You approve', body: 'In your portal, one post at a time.' },
      { title: 'We post and report', body: 'We schedule everything and send you the results each month.' },
    ],
    signoff: 'Anything we have missed, just reply to this email.',
    signature: 'The MD Media team',
  }
}

const str = (v: unknown, max: number): string => String(v ?? '').replace(/\r\n/g, '\n').slice(0, max)

/** only http(s) and mailto links may go into the email; anything else becomes no link */
export function safeLink(v: unknown): string {
  const s = String(v ?? '').trim().slice(0, 500)
  return /^(https?:\/\/|mailto:)[^\s"'<>]+$/i.test(s) ? s : ''
}

/** Whatever a browser sent, cut to the shape and the limits. Missing parts fall back to `base`. */
export function normaliseOnboarding(raw: unknown, base: OnboardingDraft): OnboardingDraft {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const short = (k: keyof OnboardingDraft) => (k in r ? str(r[k], ONBOARDING_LIMITS.short).replace(/\n/g, ' ') : String(base[k]))
  const long = (k: keyof OnboardingDraft) => (k in r ? str(r[k], ONBOARDING_LIMITS.long) : String(base[k]))
  const rows = (v: unknown, fallback: OnboardingRow[]): OnboardingRow[] => !Array.isArray(v) ? fallback : v
    .map(x => ({ label: str((x as OnboardingRow)?.label, 40).replace(/\n/g, ' '), value: str((x as OnboardingRow)?.value, 400) }))
    .filter(x => x.label.trim() || x.value.trim()).slice(0, ONBOARDING_LIMITS.rows)
  const steps = (v: unknown, fallback: OnboardingStep[]): OnboardingStep[] => !Array.isArray(v) ? fallback : v
    .map(x => ({ title: str((x as OnboardingStep)?.title, 80).replace(/\n/g, ' '), body: str((x as OnboardingStep)?.body, 300) }))
    .filter(x => x.title.trim() || x.body.trim()).slice(0, ONBOARDING_LIMITS.steps)
  return {
    subject: short('subject'), greeting: short('greeting'), intro: long('intro'),
    agreedTitle: short('agreedTitle'), agreed: rows(r.agreed, base.agreed),
    workTitle: short('workTitle'), workHeadline: short('workHeadline'), workBody: long('workBody'),
    seeTitle: short('seeTitle'), seeIntro: short('seeIntro'), see: steps(r.see, base.see),
    portalTitle: short('portalTitle'), portalBody: long('portalBody'), portalButton: short('portalButton'),
    needTitle: short('needTitle'), needBody: long('needBody'), needButton: short('needButton'),
    callTitle: short('callTitle'), callBody: long('callBody'), callButton: short('callButton'),
    callUrl: 'callUrl' in r ? safeLink(r.callUrl) : base.callUrl,
    nextTitle: short('nextTitle'), next: steps(r.next, base.next),
    signoff: long('signoff'), signature: short('signature'),
  }
}

/** What stops this draft being a finished email, in plain words. Empty = ready. */
export function onboardingProblems(d: OnboardingDraft, opts: { portalUrl: string | null }): string[] {
  const out: string[] = []
  if (!d.subject.trim()) out.push('The email needs a subject.')
  if (!d.greeting.trim()) out.push('The email needs a greeting.')
  if (!opts.portalUrl) out.push('This client has no portal link yet, so the "Open your portal" button is left out.')
  if (d.callButton.trim() && !d.callUrl) out.push('The call button has no link, so it is left out. Paste your booking link to show it.')
  return out
}

// ── templates: a named set of the words, shared across clients ──────────────────────────────────────────────────────

/** a template's name as typed, tidied; null when there is nothing to call it */
export function templateName(raw: unknown): string | null {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
  return s || null
}

/** the row id for a name: the same name, however it is capitalised or spaced, is the same template */
export function templateId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'template'
}

/**
 * A template laid over a client. The template brings the wording; what is this client's own stays this client's:
 * the subject and greeting (their name) and "what we agreed" (their agreement, not the one the template was saved on).
 */
export function applyTemplate(template: OnboardingDraft, client: OnboardingDraft): OnboardingDraft {
  return { ...template, subject: client.subject, greeting: client.greeting, agreed: client.agreed, agreedTitle: template.agreedTitle }
}

/** the portal's Brand assets tab, from the client's portal link: …/portal/<token> → …/portal/<token>/home?tab=brand */
export function brandAssetsUrl(portalUrl: string): string {
  return `${portalUrl.replace(/\/+$/, '').replace(/\/home$/, '')}/home?tab=brand`
}
