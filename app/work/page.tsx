import type { Metadata } from 'next'
import { archivo, sometype } from '../components/lama/fonts'
import LamaNav from '../components/lama/LamaNav'
import LamaFooter from '../components/lama/LamaFooter'
import WorkGrid from './WorkGrid'
import { getSiteProjects } from '../lib/websiteData'

export const metadata: Metadata = {
  title: 'Our Work — MD Media Marketing',
  description:
    'The businesses we made impossible to ignore. Hospitality, property, fashion, fragrance, engineering and health — the content, campaigns and brands we’ve built.',
  robots: 'index, follow',
  alternates: { canonical: 'https://www.mdmmarketing.com.au/work' },
}

// grid refreshes from the CMS at most every 5 minutes
export const revalidate = 300

// The static-pack Work page in the dark lama system: docked nav, filterable
// CMS-driven project grid, dark footer. Case pages live at /work/[slug].
export default async function WorkPage() {
  const projects = await getSiteProjects()

  return (
    <div className={`${archivo.variable} ${sometype.variable} bg-ink min-h-screen [&_section]:border-b-0`}>
      <LamaNav gate={false} />
      <WorkGrid projects={projects} />
      <LamaFooter vol={`Selected work · ${projects.length} projects`} />
    </div>
  )
}
