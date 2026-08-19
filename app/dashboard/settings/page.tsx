'use client'

import ProfileSettings from './ProfileSettings'
import MyPages from './MyPages'

/** Settings home = your profile + your own page preferences. */
export default function SettingsProfilePage() {
  return (
    <div className="flex flex-col gap-4">
      <ProfileSettings />
      <MyPages />
    </div>
  )
}
