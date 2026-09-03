import 'server-only'
import { table } from './db'
import type { Row, TableName } from './db-types'

function pick(src: any, cols: readonly string[]) {
  const out: Record<string, unknown> = {}
  for (const c of cols) out[c] = src?.[c] ?? null
  return out
}

/** Postgres-style `select('*, clients(name)')`: one target row per source row, or null. */
export async function attachOne<T extends object, K extends string = TableName>(
  rows: T[], fk: keyof T & string, target: TableName, cols: readonly string[], as?: K,
): Promise<(T & Record<K, Record<string, unknown> | null>)[]> {
  const key = (as ?? target) as K
  if (!rows.length) return rows as any
  const targets = await table<Row>(target).list()
  const byId = new Map(targets.map(r => [r.id, r]))
  return rows.map(r => ({ ...r, [key]: (r as any)[fk] != null && byId.has((r as any)[fk]) ? pick(byId.get((r as any)[fk]), cols) : null })) as any
}

/** Postgres-style `select('*, schedule_entries(published_at)')`: an array per source row. */
export async function attachMany<T extends object, K extends string = TableName>(
  rows: T[], localKey: keyof T & string, target: TableName, foreignKey: string, cols: readonly string[], as?: K,
): Promise<(T & Record<K, Record<string, unknown>[]>)[]> {
  const key = (as ?? target) as K
  if (!rows.length) return rows as any
  const targets = await table<Row>(target).list()
  const groups = new Map<unknown, Record<string, unknown>[]>()
  for (const t of targets) {
    const g = groups.get((t as any)[foreignKey]) ?? []
    g.push(pick(t, cols)); groups.set((t as any)[foreignKey], g)
  }
  return rows.map(r => ({ ...r, [key]: groups.get((r as any)[localKey]) ?? [] })) as any
}
