'use client'

import Acquisition from '../Acquisition'
import LeadsReportCard from './LeadsReportCard'
import { useRole } from '../../../useRole'

/**
 * the acquisition system's reporting view (acquisition-core.ts; the blueprint of 21 Sep 2026), and MD Media's own
 * monthly leads report — moved here from the client Reports page, which is the clients' (the owner, 2 Nov 2026:
 * "why the hell is it in the reports page, this is the client")
 */
export default function Page() {
  const { me } = useRole()
  return (
    <div className="flex flex-col gap-6">
      <Acquisition view="reporting" />
      {me?.role === 'super_admin' && <LeadsReportCard />}
    </div>
  )
}
