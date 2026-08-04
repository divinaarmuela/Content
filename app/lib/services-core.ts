/**
 * Pure service-tag logic — no imports, safe on both sides.
 *
 * Services were a free-text comma field, so the same idea arrived spelled
 * several ways ("Social Media" / "Social Media Management", "Production" /
 * "Content Production"). Every one of those becomes its own filter chip on
 * /work, which is how a filter row turns into noise. The picker offers what
 * already exists so the obvious choice is to reuse a tag; typing a new one is
 * still allowed, because a fixed list would be wrong the first time the agency
 * sells something new.
 */

/** Trim and collapse internal whitespace. Display form is preserved. */
export function normaliseService(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

/** Case-insensitive identity, so "Paid Ads" and "paid ads" are one tag. */
const key = (value: string) => normaliseService(value).toLowerCase()

/**
 * Every distinct service across the projects, most used first.
 *
 * Frequency order matters for the filter row: the tags that describe most of
 * the work should be the ones nearest the left, not whatever sorts first
 * alphabetically. Ties break alphabetically so the order is stable between
 * renders rather than depending on row order.
 */
export function collectServices(projects: { services: string[] }[]): string[] {
  const counts = new Map<string, { label: string; n: number }>()
  for (const project of projects) {
    // a project listing the same tag twice must not count twice
    const seen = new Set<string>()
    for (const raw of project.services ?? []) {
      const label = normaliseService(raw)
      if (!label) continue
      const k = key(label)
      if (seen.has(k)) continue
      seen.add(k)
      const entry = counts.get(k)
      if (entry) entry.n++
      else counts.set(k, { label, n: 1 })
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .map(e => e.label)
}

/**
 * Add a service to a project's list.
 *
 * Returns the list unchanged when the tag is empty or already present under
 * any casing, so re-picking from the dropdown cannot create a duplicate.
 */
export function addService(list: string[], value: string): string[] {
  const label = normaliseService(value)
  if (!label) return list
  return list.some(s => key(s) === key(label)) ? list : [...list, label]
}

export function removeService(list: string[], value: string): string[] {
  return list.filter(s => key(s) !== key(value))
}

/** Known tags not yet on this project — what the dropdown should offer. */
export function suggestServices(known: string[], selected: string[]): string[] {
  const taken = new Set(selected.map(key))
  return known.filter(s => !taken.has(key(s)))
}

/** Does a project carry this service? Case-insensitive, for the /work filter. */
export function hasService(projectServices: string[], service: string): boolean {
  return projectServices.some(s => key(s) === key(service))
}
