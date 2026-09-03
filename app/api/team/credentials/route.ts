import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { AgencyCredential } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { explainDbError } from '@/app/lib/db-errors'
import { encryptSecret, decryptSecret, credentialsKeyConfigured } from '@/app/lib/secret-box'

/**
 * MD Media's own platform logins.
 *
 * Identical rules to client credentials — encrypted at rest, never returned by
 * the list, revealed one at a time — but owned by the agency rather than a
 * client. Kept in its own table because hanging them off a placeholder client
 * row would make them show up inside that client's panel.
 *
 * Read and reveal: any team member from account_manager up. Change: super_admin.
 */

/** The columns the list has always returned — nothing else leaves this route. */
const listShape = (r: AgencyCredential) => ({
  id: r.id, platform: r.platform, label: r.label, username: r.username,
  url: r.url, notes: r.notes, updated_at: r.updated_at,
  updated_by_name: r.updated_by_name, secret_cipher: r.secret_cipher,
})

const redact = (row: Record<string, unknown>) => {
  const { secret_cipher, ...rest } = row
  return { ...rest, has_secret: Boolean(secret_cipher) }
}

export async function GET() {
  return withRequestCache(async () => {
  try {
    await requireRole('account_manager')
    let rows: AgencyCredential[]
    try {
      rows = await table<AgencyCredential>('agency_credentials').list({ orderBy: [['platform', 'asc']] })
    } catch (e) {
      throw new Error(explainDbError((e as Error).message, 'client_records.sql'))
    }
    return NextResponse.json(rows.map(r => redact(listShape(r))))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

export async function POST(req: Request) {
  return withRequestCache(async () => {
  try {
    const me = await requireRole('account_manager')
    const body = await req.json()

    if (body.action === 'reveal') {
      if (!body.credentialId) {
        return NextResponse.json({ error: 'credentialId is required' }, { status: 400 })
      }
      let data: AgencyCredential | null
      try {
        data = await table<AgencyCredential>('agency_credentials').get(String(body.credentialId))
      } catch (e) {
        throw new Error(explainDbError((e as Error).message, 'client_records.sql'))
      }
      if (!data?.secret_cipher) return NextResponse.json({ secret: '' })
      try {
        return NextResponse.json({ secret: decryptSecret(data.secret_cipher) })
      } catch {
        return NextResponse.json(
          { error: 'Could not decrypt — CREDENTIALS_KEY may have changed since this was saved.' },
          { status: 500 },
        )
      }
    }

    await requireRole('super_admin')
    if (!String(body.platform ?? '').trim()) {
      return NextResponse.json({ error: 'A platform is required' }, { status: 400 })
    }
    if (body.secret && !credentialsKeyConfigured()) {
      return NextResponse.json(
        { error: 'CREDENTIALS_KEY is not set — refusing to store a password unencrypted.' },
        { status: 503 },
      )
    }

    let created: AgencyCredential
    try {
      created = await table('agency_credentials').insert({
        platform: body.platform,
        label: body.label ?? '',
        username: body.username ?? '',
        secret_cipher: body.secret ? encryptSecret(String(body.secret)) : null,
        url: body.url ?? '',
        notes: body.notes ?? '',
        updated_by: me.id,
        updated_by_name: me.name || me.email,
      }) as unknown as AgencyCredential
    } catch (e) {
      throw new Error(explainDbError((e as Error).message, 'client_records.sql'))
    }
    return NextResponse.json(redact(listShape(created)), { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

export async function PATCH(req: Request) {
  return withRequestCache(async () => {
  try {
    const me = await requireRole('super_admin')
    const body = await req.json()
    if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const patch: Record<string, unknown> = {
      updated_by: me.id,
      updated_by_name: me.name || me.email,
    }
    for (const k of ['platform', 'label', 'username', 'url', 'notes']) {
      if (k in body) patch[k] = body[k]
    }
    // blank means leave it alone, not erase it
    if (typeof body.secret === 'string' && body.secret.length > 0) {
      if (!credentialsKeyConfigured()) {
        return NextResponse.json(
          { error: 'CREDENTIALS_KEY is not set — refusing to store a password unencrypted.' },
          { status: 503 },
        )
      }
      patch.secret_cipher = encryptSecret(body.secret)
    }

    let updated: AgencyCredential | null
    try {
      updated = await table('agency_credentials').update(String(body.id), patch) as unknown as AgencyCredential | null
    } catch (e) {
      throw new Error(explainDbError((e as Error).message, 'client_records.sql'))
    }
    if (!updated) return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    return NextResponse.json(redact(listShape(updated)))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

export async function DELETE(req: Request) {
  return withRequestCache(async () => {
  try {
    await requireRole('super_admin')
    const credentialId = new URL(req.url).searchParams.get('credentialId')
    if (!credentialId) return NextResponse.json({ error: 'credentialId is required' }, { status: 400 })

    try {
      await table<AgencyCredential>('agency_credentials').remove(credentialId)
    } catch (e) {
      throw new Error(explainDbError((e as Error).message, 'client_records.sql'))
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
