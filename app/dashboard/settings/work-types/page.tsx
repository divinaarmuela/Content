'use client'

import WorkKindsSettings from '../WorkKindsSettings'

/**
 * Work types has its own tab now.
 *
 * It used to live at the bottom of the tab labelled "Profile", which is the
 * last place anyone would look for the setting that governs every dropdown in
 * the New item dialog — and it had a second hidden door, "+ New type…" as the
 * last row of that dropdown. Two hidden entrances to one setting is one more
 * than it should have.
 */
export default function WorkTypesSettingsPage() {
  return <WorkKindsSettings />
}
