import 'server-only'
import { supabase } from '@/lib/supabase'
import { canSeePage } from './page-access-core'
import type { TeamUser } from './authz'

/**
 * Server-side page visibility.
 *
 * The sidebar hides what a person may not see; this is the same question
 * asked where it counts. A page opened to someone in Settings must also open
 * the data behind it, or the link leads to an error — and a page NOT opened
 * must refuse the data, or hiding the link was only decoration.
 */

/** Grants and hides for one person. A hidden row is a PREFERENCE, never a
 *  grant — treating it as one let anyone self-hide a page to gain its data. */
async function pageAccessRows(teamUserId: string): Promise<{ granted: string[]; hidden: string[] }> {
  const { data } = await supabase
    .from('user_page_access').select('href, hidden').eq('team_user_id', teamUserId)
  const granted: string[] = []
  const hidden: string[] = []
  for (const r of data ?? []) {
    if (r.hidden) hidden.push(r.href as string)
    else granted.push(r.href as string)
  }
  return { granted, hidden }
}

/** Pages granted to one person, as hrefs. */
export async function grantedPages(teamUserId: string): Promise<string[]> {
  return (await pageAccessRows(teamUserId)).granted
}

/** May this person reach this dashboard page — by role, or by grant? */
export async function userMaySeePage(user: TeamUser, href: string): Promise<boolean> {
  if (user.role === 'super_admin') return true
  const { granted, hidden } = await pageAccessRows(user.id)
  return canSeePage(user.role, href, granted, hidden)
}
