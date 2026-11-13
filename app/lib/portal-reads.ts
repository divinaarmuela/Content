import 'server-only'
import { table } from '@/lib/db'
import type { TableName } from '@/lib/db-types'

/**
 * READ A FEW ROWS, NOT THE TABLE (the owner, 13 Nov 2026: "why so slow these portal, is there a way to make it
 * faster"). One portal page view was downloading about 14 MB from the database in 37 reads, because "the rows whose
 * id is one of these" was written as "read the whole table and keep the ones I want". These ask for the rows
 * themselves. Past MANY ids the whole-table read is the cheaper one again, so it is kept as the fallback.
 */
const MANY = 60

/** the order a whole-table read gives: by id. Code downstream leans on it (the first of two wins), so it is kept */
const byId = <T extends { id: string }>(rows: T[]): T[] => rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

/** the rows with these ids, each asked for by its own address */
export async function rowsByIds<T extends { id: string }>(name: TableName, ids: readonly string[]): Promise<T[]> {
  const want = [...new Set(ids.filter(Boolean))]
  if (want.length === 0) return []
  if (want.length > MANY) {
    const set = new Set(want)
    return table<T>(name).list({ where: r => set.has(r.id) })
  }
  const rows = await Promise.all(want.map(id => table<T>(name).get(id).catch(() => null)))
  return byId(rows.filter((r): r is Awaited<T> => !!r) as T[])
}

/** the rows whose indexed column is one of these values (item_id, client_id …), one indexed read per value */
export async function rowsByColumn<T extends { id: string }>(name: TableName, column: keyof T & string, values: readonly string[]): Promise<T[]> {
  const want = [...new Set(values.filter(Boolean))]
  if (want.length === 0) return []
  if (want.length > MANY) {
    const set = new Set(want)
    return table<T>(name).list({ where: r => set.has(String((r as Record<string, unknown>)[column] ?? '')) })
  }
  const lists = await Promise.all(want.map(v => table<T>(name).list({ by: { [column]: v } as unknown as Partial<T> })))
  return byId(lists.flat())
}
