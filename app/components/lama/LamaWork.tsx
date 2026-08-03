import LamaWorkRows from './LamaWorkRows'
import { getSiteProjects } from '../../lib/websiteData'

// Case rows mirroring the reference's js-case-item anatomy. Data comes from
// the CMS (dashboard → Supabase) with the hardcoded list as fallback; the
// interactive accordion lives in LamaWorkRows (client).
export default async function LamaWork() {
  const projects = await getSiteProjects()
  return <LamaWorkRows projects={projects} />
}
