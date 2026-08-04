import 'server-only'
import { revalidatePath } from 'next/cache'

/**
 * Purge the public pages that render CMS projects.
 *
 * Without this, unpublishing a project changed nothing a visitor could see:
 * /work and /work/[slug] are ISR pages built at deploy time, so they kept
 * serving the prerendered HTML until `revalidate` lapsed — and the case study
 * for a hidden project stayed live and indexable in the meantime. A CMS toggle
 * that takes five minutes to matter is a CMS toggle nobody trusts.
 *
 * The slug page is purged by type rather than by path so it covers every
 * project at once, including the one just hidden — passing the single slug
 * would leave the *other* pages showing it in their "next case study" link.
 *
 * Never throws: a failed purge means slightly stale pages, which must not turn
 * a successful save into a failed request.
 */
export function revalidateSiteProjects(): void {
  try {
    revalidatePath('/work')
    revalidatePath('/work/[slug]', 'page')
    revalidatePath('/')          // the homepage lists projects too
  } catch {
    // best effort by design — see above
  }
}
