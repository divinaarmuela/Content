import { archivo, sometype } from '../components/lama/fonts'
import MdNav from '../components/md-nav/MdNav'
import MdFooter from '../components/md-footer/MdFooter'
import LamaContact from '../components/lama/LamaContact'
import ScrollObserver from '../components/ScrollObserver'
import JournalIndex from './JournalIndex'
import { getJournalPosts } from '../lib/journalPosts'

// Posts refresh from the CMS at most every 5 minutes; publishing purges this
// page immediately via revalidateJournal, so the window only matters when a
// row changes outside the dashboard.
export const revalidate = 300

export default async function JournalPage() {
  const posts = await getJournalPosts()

  return (
    <div className={`${archivo.variable} ${sometype.variable} bg-ink min-h-screen [&_section]:border-b-0`}>
      <MdNav band />
      <JournalIndex posts={posts} />
      <LamaContact gate={false} />
      <MdFooter />
      <ScrollObserver />
    </div>
  )
}
