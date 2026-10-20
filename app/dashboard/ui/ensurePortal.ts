'use client'

/**
 * A CLIENT'S PORTAL, MADE IN THE SAME PRESS (the owner, 20 Oct 2026: "If a client has no portal yet, the button would
 * offer 'Make their portal and share' in one press, instead of an error" — "editing and boards"). The token they have,
 * or a new one-link portal for them (POST /api/website/clients/<id>/portal; a manager's). Null when it could not.
 */
export async function ensureClientPortal(clientId: string, existing?: string | null): Promise<string | null> {
  if (existing && existing.trim()) return existing.trim()
  try {
    const res = await fetch(`/api/website/clients/${clientId}/portal`, { method: 'POST' })
    if (!res.ok) return null
    const body = await res.json().catch(() => ({})) as { token?: string }
    return body.token ?? null
  } catch {
    return null
  }
}
