'use client'

import DriveFolderCard from '../DriveFolderCard'
import IntegrationsSettings from '../IntegrationsSettings'

export default function IntegrationsPage() {
  return (
    <div className="flex flex-col gap-6">
      <IntegrationsSettings />
      {/* where Drive files land — shown under the connection it belongs to */}
      <DriveFolderCard />
    </div>
  )
}
