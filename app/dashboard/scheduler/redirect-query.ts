/**
 * What a redirect off the old Scheduler addresses has to carry with it.
 *
 * `?column=`, `?show=` and `?card=` are real deep links — the Overview's
 * lenses and the bell write them — so a redirect that dropped them would land
 * somebody on a board that had forgotten what they were sent to see. Values
 * are flattened to the first one: every parameter here is single-valued, and
 * `scheduleViewHref` takes strings.
 */
export type IncomingParams = Record<string, string | string[] | undefined>

export async function queryOf(
  searchParams: Promise<IncomingParams>,
): Promise<Record<string, string>> {
  const params = await searchParams
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(params)) {
    // `view` is the destination's own, and it is set by the caller
    if (key === 'view') continue
    const first = Array.isArray(value) ? value[0] : value
    if (typeof first === 'string' && first !== '') out[key] = first
  }
  return out
}
