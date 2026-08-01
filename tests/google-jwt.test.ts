import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, createVerify } from 'crypto'
import { buildClaims, signAssertion, normalizePrivateKey, base64url } from '../app/lib/google-jwt'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const decode = (seg: string) =>
  JSON.parse(Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())

describe('base64url', () => {
  it('is url-safe and unpadded', () => {
    const out = base64url(Buffer.from([251, 255, 190]))
    expect(out).not.toMatch(/[+/=]/)
  })
})

describe('buildClaims', () => {
  const base = {
    serviceAccountEmail: 'scanner@proj.iam.gserviceaccount.com',
    subject: 'hello@mdmmarketing.com.au',
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    nowSec: 1_800_000_000,
  }
  it('impersonates via sub and targets the token endpoint', () => {
    const c = buildClaims(base)
    expect(c.iss).toBe(base.serviceAccountEmail)
    expect(c.sub).toBe('hello@mdmmarketing.com.au')
    expect(c.aud).toBe('https://oauth2.googleapis.com/token')
    expect(c.exp - c.iat).toBe(3600)
  })
  it('caps lifetime at one hour (Google rejects longer)', () => {
    const c = buildClaims({ ...base, lifetimeSec: 99_999 })
    expect(c.exp - c.iat).toBe(3600)
  })
  it('honours a shorter lifetime', () => {
    const c = buildClaims({ ...base, lifetimeSec: 600 })
    expect(c.exp - c.iat).toBe(600)
  })
})

describe('normalizePrivateKey', () => {
  it('restores escaped newlines from env files', () => {
    const escaped = '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----'
    expect(normalizePrivateKey(escaped)).toBe('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----')
  })
})

describe('signAssertion', () => {
  const claims = buildClaims({
    serviceAccountEmail: 'scanner@proj.iam.gserviceaccount.com',
    subject: 'contact@mdmmarketing.com.au',
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    nowSec: Math.floor(Date.now() / 1000),
  })

  it('produces a three-part JWT whose signature verifies', () => {
    const jwt = signAssertion(claims, privateKey)
    const parts = jwt.split('.')
    expect(parts).toHaveLength(3)

    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${parts[0]}.${parts[1]}`)
    verifier.end()
    const sig = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    expect(verifier.verify(publicKey, sig)).toBe(true)
  })

  it('carries RS256 header and the impersonated subject', () => {
    const [h, p] = signAssertion(claims, privateKey).split('.')
    expect(decode(h)).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(decode(p).sub).toBe('contact@mdmmarketing.com.au')
  })

  it('accepts a key with escaped newlines (env-file form)', () => {
    const escaped = privateKey.replace(/\n/g, '\\n')
    expect(() => signAssertion(claims, escaped)).not.toThrow()
  })
})
