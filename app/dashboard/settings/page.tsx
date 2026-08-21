'use client'

import ProfileSettings from './ProfileSettings'
import MyPages from './MyPages'
import WorkKindsSettings from './WorkKindsSettings'

/** Settings home = your profile + your own page preferences. */
export default function SettingsProfilePage() {
  return (
    <div className="flex flex-col gap-4">
      <ProfileSettings />
      <MyPages />
      <WorkKindsSettings />
    </div>
  )
}
