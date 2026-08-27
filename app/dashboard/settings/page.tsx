'use client'

import ProfileSettings from './ProfileSettings'
import MyPages from './MyPages'

/** Settings home = your profile + your own page preferences. Work types used
 *  to be hidden down here too; it has its own tab now. */
export default function SettingsProfilePage() {
  return (
    <div className="flex flex-col gap-4">
      <ProfileSettings />
      <MyPages />
    </div>
  )
}
