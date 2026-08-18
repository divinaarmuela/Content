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

/** Pages granted to one person, as hrefs. */
export async function grantedPages(teamUserId: string): Promise<string[]> {
  const { data } = await supabase
    .from('user_page_access').select('href').eq('team_user_id', teamUserId)
  return (data ?? []).map(r => r.href as string)
}

/** May this person reach this dashboard page — by role, or by grant? */
export async function userMaySeePage(user: TeamUser, href: string): Promise<boolean> {
  if (user.role === 'super_admin') return true
  return canSeePage(user.role, href, await grantedPages(user.id))
}
