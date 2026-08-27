import 'server-only'
import { after } from 'next/server'
import { supabase } from '@/lib/supabase'
import { driveStatus, rootFolderId } from './gdrive'
import { grantUserPermission, listPermissions, revokePermission } from './gdrive-files'
import {
  membersNeedingPermission, memberPermissionDiff, sharingSummary,
  type MemberLike,
} from './gdrive-mirror-core'

/**
 * Personal-email team members, and the root folder they need to reach.
 *
 * The domain share the connect flow sets up covers everyone at the agency's
 * Workspace and nobody else — which was fine until the answer to "can the
 * freelance editor on a Gmail address open the footage" turned out to be no.
 * So every active team member whose address the domain grant does NOT cover
 * gets a writer permission of their own on the ROOT folder, and inherits from
 * there: one permission per person for the whole tree, rather than one per
 * person per shoot, which would be thousands of grants and no way to revoke
 * them when someone leaves.
 *
 * ── Reconciliation, not events ──
 *
 * `syncDriveMembers()` is given nothing and computes everything: who should
 * have access, who does, and the difference. That makes it idempotent, safe to
 * call from four places, and — the part that actually matters — self-healing.
 * A team change that happened while Drive was down, or before Drive was ever
 * connected, is corrected by the next run rather than lost forever. An
 * event-shaped "add this person / remove that person" would have needed a
 * queue and would still have drifted.
 *
 * ── What it will not do ──
 *
 * Clients never get a permission, at any level. The root holds every client's
 * raw footage, so a client with access to it can see every other client's
 * work; the portal exists precisely so they never need to. And `.invalid`
 * addresses are refused outright — the test suite is addressed there, and a
 * permission is not something to discover a test created.
 */

export type MemberSyncResult = {
  ok: boolean
  reason?: string
  added: string[]
  removed: string[]
  /** how many people hold a permission of their own once this is done */
  personal: number
  domain: string | null
}

const skipped = (reason: string): MemberSyncResult =>
  ({ ok: false, reason, added: [], removed: [], personal: 0, domain: null })

/** Active team members who are not clients. The pure module does the rest of
 *  the filtering; this is only the read. */
async function teamMembers(): Promise<MemberLike[]> {
  const { data, error } = await supabase
    .from('team_users')
    .select('email, role, active_status')
    .eq('active_status', true)
  if (error) return []
  return (data ?? []) as MemberLike[]
}

/**
 * Make the root folder's people match the team.
 *
 * Never throws: every caller is on a path where the user's actual action —
 * inviting someone, changing a role, connecting Drive — must succeed whatever
 * Google says. A failure here is a log line and a `reason`, and the next
 * reconcile fixes it.
 */
export async function syncDriveMembers(): Promise<MemberSyncResult> {
  try {
    const status = await driveStatus()
    if (!status.configured) return skipped('not_configured')
    if (!status.connected) return skipped('not_connected')

    const root = await rootFolderId()
    if (!root) return skipped('no_root_folder')

    const desired = membersNeedingPermission(await teamMembers(), {
      sharingDomain: status.sharing_domain,
      accountEmail: status.account_email,
    })

    const live = await listPermissions(root)
    if (!live.ok) {
      console.error('[gdrive] could not read folder permissions:', live.message, live.detail)
      return { ...skipped('permissions_unreadable'), domain: status.sharing_domain }
    }

    const diff = memberPermissionDiff(desired, live.permissions)

    const added: string[] = []
    for (const email of diff.add) {
      const res = await grantUserPermission(root, email)
      // one refusal — a Workspace that forbids external sharing, an address
      // with no Google account — is not the rest of the team's problem
      if (res.ok) added.push(email)
      else console.error('[gdrive] could not share with', email, res.message, res.detail)
    }
    const removed: string[] = []
    for (const p of diff.remove) {
      const res = await revokePermission(root, p.id)
      if (res.ok) removed.push(p.email)
      else console.error('[gdrive] could not revoke', p.email, res.message)
    }

    return {
      ok: true,
      added,
      removed,
      personal: desired.length,
      domain: status.sharing_domain,
    }
  } catch (e) {
    console.error('[gdrive] member sync failed:', e)
    return skipped(e instanceof Error ? e.message : 'sync_failed')
  }
}

/**
 * Fire-and-forget, for the team routes.
 *
 * Adding someone to the team is the user's action and must return at the speed
 * of one database write; sharing a Drive folder with them is ours, and is
 * several round trips to Google. `after()` for the same reason the folder
 * hooks use it — a serverless function that has sent its response can be
 * frozen, and this needs to outlive the response.
 */
export function onTeamChanged(label: string): void {
  const job = async () => {
    const res = await syncDriveMembers()
    if (res.ok && (res.added.length || res.removed.length)) {
      console.log(`[gdrive] ${label}: shared with ${res.added.length}, revoked ${res.removed.length}`)
    }
  }
  try {
    after(() => job().catch(e => console.error('[gdrive] member sync:', e)))
  } catch {
    void job().catch(e => console.error('[gdrive] member sync:', e))
  }
}

/**
 * The one line the Integrations card shows about people.
 *
 * Computed from the TEAM, not by asking Drive: the card is rendered on every
 * Settings visit, and a settings page that waits on (or fails with) a Google
 * round trip to tell you about sharing is worse than one that tells you who
 * should have access. The "Re-share with team" button is what makes the two
 * agree, and it reports what it actually changed.
 */
export async function driveMemberNote(
  domain: string | null, accountEmail: string | null,
): Promise<{ note: string; personal: number }> {
  const desired = membersNeedingPermission(await teamMembers(), {
    sharingDomain: domain, accountEmail,
  })
  return { note: sharingSummary(domain, desired.length), personal: desired.length }
}
