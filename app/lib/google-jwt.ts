/**
 * Pure helpers for Google service-account JWT assertions (domain-wide
 * delegation). No imports beyond node:crypto — unit-testable.
 */
import { createSign } from 'crypto'

export const base64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export type JwtClaims = {
  iss: string
  sub: string
  scope: string
  aud: string
  iat: number
  exp: number
}

/** Claim set for impersonating `subject` with a service account.
 *  `nowSec` is injectable so tests are deterministic. */
export function buildClaims(input: {
  serviceAccountEmail: string
  subject: string
  scope: string
  nowSec: number
  lifetimeSec?: number
}): JwtClaims {
  const life = Math.min(input.lifetimeSec ?? 3600, 3600) // Google caps at 1h
  return {
    iss: input.serviceAccountEmail,
    sub: input.subject,
    scope: input.scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: input.nowSec,
    exp: input.nowSec + life,
  }
}

/** Private keys pasted into env files usually carry literal "\n" sequences —
 *  restore real newlines, or the PEM parser rejects them. */
export function normalizePrivateKey(raw: string): string {
  return raw.replace(/\\n/g, '\n').trim()
}

/** Signed RS256 assertion for the OAuth2 JWT-bearer grant. */
export function signAssertion(claims: JwtClaims, privateKeyPem: string): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify(claims))
  const signingInput = `${header}.${payload}`
  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  signer.end()
  const signature = base64url(signer.sign(normalizePrivateKey(privateKeyPem)))
  return `${signingInput}.${signature}`
}
