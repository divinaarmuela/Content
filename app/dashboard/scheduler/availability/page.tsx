import { redirect } from 'next/navigation'

/**
 * Availability moved to Production — booking a shoot is pre-production work,
 * not posting work. The query string has to survive the hop: the Google
 * Calendar OAuth callback lands here with `?cal=…&detail=…`, and dropping it
 * would turn "couldn't connect that calendar" into a silent success.
 */
export default async function SchedulerAvailabilityRedirect(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  const params = await searchParams
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach(v => qs.append(key, v))
    else if (value !== undefined) qs.set(key, value)
  }
  const suffix = qs.toString()
  redirect(`/dashboard/production/availability${suffix ? `?${suffix}` : ''}`)
}
