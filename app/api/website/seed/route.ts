import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { guard } from '@/app/lib/authz'
import { clients as hardcoded, wixImg } from '../../../components/lama/workData'

/** One-time import: copies the hardcoded workData projects into the CMS.
 *  Creates a client row per project and a published project row. Skips any
 *  slug that already exists, so it's safe to run again. */
export async function POST() {
  return withRequestCache(async () => {
    const denied = await guard('super_admin')
    if (denied) return denied

    let existing: Record<string, unknown>[]
    try {
      existing = await table('projects').list()
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 })
    }
    const have = new Set(existing.map(r => r.slug))

    let created = 0
    for (const [i, c] of hardcoded.entries()) {
      if (have.has(c.slug)) continue

      let clientRow: { id: string }
      try {
        // `status` is minted only for a client this run CREATES — Postgres
        // defaulted it to 'active' and a client with no status shows up on no
        // list, but re-running the seed must not un-archive an existing one.
        const already = await table('clients')
          .list({ where: r => r.slug === c.slug, limit: 1 })
          .then(r => r[0] ?? null)
        clientRow = await table('clients').upsert(
          {
            slug: c.slug, name: c.name, industry: c.industry,
            status: (already?.status as string | undefined) ?? 'active',
          },
          { onConflict: 'slug' },
        )
      } catch (e) {
        return NextResponse.json({ error: `client ${c.slug}: ${(e as Error).message}` }, { status: 500 })
      }

      try {
        await table('projects').insert({
          client_id: clientRow.id,
          slug: c.slug,
          name: c.name,
          industry: c.industry,
          tag: c.tag,
          services: c.services,
          description: c.desc,
          card_media_url: wixImg(c.img, 1000, 800),
          hero_media_url: wixImg(c.img, 1600, 800),
          result: c.result ?? null,
          challenge: c.study.challenge,
          approach: c.study.approach,
          outcome: c.study.outcome,
          sort_order: (i + 1) * 10,
          published: true,
        })
      } catch (e) {
        return NextResponse.json({ error: `project ${c.slug}: ${(e as Error).message}` }, { status: 500 })
      }
      created++
    }

    return NextResponse.json({ created, skipped: hardcoded.length - created })
  })
}
