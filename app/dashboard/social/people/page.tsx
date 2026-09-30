import { redirect } from 'next/navigation'

/**
 * THE PEOPLE PAGE IS OFF (the owner, 30 Sep 2026: "next push we don't need the People page"). It was built on a
 * third-party read of each account's followers and likers, now switched off (FOLLOWER_SCAN_ON, follower-source.ts).
 * An old link or bookmark lands on Social instead of a broken page. The page's code is in git history.
 */
export default function PeoplePage() {
  redirect('/dashboard/social')
}
