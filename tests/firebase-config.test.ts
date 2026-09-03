import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const KEYS = ['NEXT_PUBLIC_FIREBASE_API_KEY','NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN','NEXT_PUBLIC_FIREBASE_PROJECT_ID','NEXT_PUBLIC_FIREBASE_APP_ID','NEXT_PUBLIC_FIREBASE_DATABASE_URL'] as const
const saved: Record<string, string | undefined> = {}

describe('firebase-config', () => {
  beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; process.env[k] = `v-${k}` } })
  afterEach(() => { for (const k of KEYS) process.env[k] = saved[k] })

  it('reads the five public vars', async () => {
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL = 'https://x-default-rtdb.firebasedatabase.app/'
    const { firebaseConfig, rtdbUrl } = await import('@/lib/firebase-config')
    expect(firebaseConfig().projectId).toBe('v-NEXT_PUBLIC_FIREBASE_PROJECT_ID')
    expect(rtdbUrl()).toBe('https://x-default-rtdb.firebasedatabase.app')
  })

  it('throws a plain message when the database url is missing', async () => {
    delete process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL
    const { rtdbUrl } = await import('@/lib/firebase-config')
    expect(() => rtdbUrl()).toThrow(/NEXT_PUBLIC_FIREBASE_DATABASE_URL/)
  })
})
