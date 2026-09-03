import { installFakeRtdb } from './fake-rtdb'
import type { Row, TableName } from '@/lib/db-types'

/**
 * Seed a fake Realtime Database and hand back the real `@/lib/db` running
 * against it. Use in route tests:
 *   const fake = seedDb({ clients: [{ id: 'c1', name: 'Acme' }] })
 *   afterEach(() => fake.restore())
 */
export function seedDb(seed: Partial<Record<TableName, Row[]>>) {
  const tables: Record<string, Record<string, Row>> = {}
  for (const [t, rows] of Object.entries(seed)) tables[t] = Object.fromEntries((rows ?? []).map(r => [r.id, r]))
  const fake = installFakeRtdb({ mdm: { tables } })
  return {
    ...fake,
    rows: (name: TableName): Row[] => Object.values(fake.tree().mdm?.tables?.[name] ?? {}),
  }
}
