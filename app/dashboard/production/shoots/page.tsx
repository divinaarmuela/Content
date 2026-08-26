import { redirect } from 'next/navigation'

/** Shoots ARE Production now — the list moved up a level. Kept as a redirect
 *  so existing links and bookmarks still land somewhere sensible. */
export default function ShootsIndexRedirect() {
  redirect('/dashboard/production')
}
