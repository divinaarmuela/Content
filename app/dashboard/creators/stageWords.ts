import type { ChipTone } from '../ui/Chip'
import type { CampaignStatus, CreatorStage } from '../../lib/creator-campaign-core'

/** The words and colours the team's creator pages use for a stage and for each move out of it. Rules are the core's. */

export const STAGE_TONE: Record<CreatorStage, ChipTone> = {
  idea: 'muted', with_client: 'amber', approved: 'blue', passed: 'red', invited: 'blue', confirmed: 'green', declined: 'red',
}

/** the order the Creators list is read in: what needs somebody first */
export const STAGE_ORDER: readonly CreatorStage[] = ['with_client', 'approved', 'invited', 'confirmed', 'idea', 'passed', 'declined']

export const STAGE_HELP: Record<CreatorStage, string> = {
  idea: 'Only the team sees these',
  with_client: 'Waiting on the client’s yes or no',
  approved: 'The client said yes. Invite them',
  passed: 'The client said no',
  invited: 'Invited. Waiting on their answer',
  confirmed: 'Coming',
  declined: 'Said no, or dropped out',
}

const MOVE: Partial<Record<`${CreatorStage}>${CreatorStage}`, string>> = {
  'idea>with_client': 'Show to client',
  'with_client>idea': 'Take back',
  'with_client>approved': 'Approve for the client',
  'with_client>passed': 'Pass for the client',
  'approved>invited': 'Mark invited',
  'passed>with_client': 'Show to client again',
  'invited>confirmed': 'Mark confirmed',
  'invited>declined': 'Mark declined',
  'confirmed>declined': 'Mark declined',
  'declined>invited': 'Invite again',
}
export const moveWords = (from: CreatorStage, to: CreatorStage): string => MOVE[`${from}>${to}`] ?? to

export const STATUS_WORDS: Record<CampaignStatus, string> = { draft: 'Draft', live: 'Live', closed: 'Closed' }
export const STATUS_TONE: Record<CampaignStatus, ChipTone> = { draft: 'muted', live: 'green', closed: 'surface' }

export const FIELD = 'h-11 w-full rounded-inner border border-border bg-surface px-3 text-[14px] text-foreground outline-none focus:border-foreground'
export const AREA = 'w-full rounded-inner border border-border bg-surface p-3 text-[14px] text-foreground outline-none focus:border-foreground'
export const LABEL = 'text-[13px] font-semibold'

/** "Fri 27 Nov, 12:30 pm" — Melbourne time, the same the client is shown — or null */
export function whenWords(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}
