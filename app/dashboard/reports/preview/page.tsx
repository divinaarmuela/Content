import { Suspense } from 'react'
import ReportV2 from '../v2/ReportV2'

/** /dashboard/reports/preview — the rebuilt report, read only, before it replaces Reports (owner, 5 Nov 2026). The API
 *  it reads (/api/reports/preview) admits super admins and account managers only. Not in the sidebar. */
export default function ReportPreviewPage() {
  return <Suspense fallback={null}><ReportV2 /></Suspense>
}
