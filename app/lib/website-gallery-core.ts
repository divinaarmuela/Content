// Pure helpers for the project gallery editor — no I/O (workflow-core pattern).

/** Return a new array with arr[index] shifted by delta positions.
 *  Moves past either end clamp; an invalid index returns a copy unchanged. */
export function moveItem<T>(arr: readonly T[], index: number, delta: number): T[] {
  const next = [...arr]
  if (index < 0 || index >= arr.length) return next
  const target = Math.min(arr.length - 1, Math.max(0, index + delta))
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}

/** Sanitize a client-supplied gallery list: keep trimmed non-empty strings. */
export function normalizeUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string')
    .map(v => v.trim())
    .filter(Boolean)
}
