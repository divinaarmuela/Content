import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
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

const listSelect = 'id,platform,label,username,url,notes,updated_at,updated_by_name,secret_cipher'

const redact = (row: Record<string, unknown>) => {
  const { secret_cipher, ...rest } = row
  return { ...rest, has_secret: Boolean(secret_cipher) }
}

export async function GET() {
  try {
    await requireRole('account_manager')
    const { data, error } = await supabase
      .from('agency_credentials')
      .select(listSelect)
      .order('platform', { ascending: true })
    if (error) throw new Error(explainDbError(error.message, 'client_records.sql'))
    return NextResponse.json((data ?? []).map(redact))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function POST(req: Request) {
  try {
    const me = await requireRole('account_manager')
    const body = await req.json()

    if (body.action === 'reveal') {
      if (!body.credentialId) {
        return NextResponse.json({ error: 'credentialId is required' }, { status: 400 })
      }
      const { data, error } = await supabase
        .from('agency_credentials')
        .select('secret_cipher')
        .eq('id', body.credentialId)
        .single()
      if (error) throw new Error(explainDbError(error.message, 'client_records.sql'))
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

    const { data, error } = await supabase
      .from('agency_credentials')
      .insert({
        platform: body.platform,
        label: body.label ?? '',
        username: body.username ?? '',
        secret_cipher: body.secret ? encryptSecret(String(body.secret)) : null,
        url: body.url ?? '',
        notes: body.notes ?? '',
        updated_by: me.id,
        updated_by_name: me.name || me.email,
      })
      .select(listSelect)
      .single()

    if (error) throw new Error(explainDbError(error.message, 'client_records.sql'))
    return NextResponse.json(redact(data), { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function PATCH(req: Request) {
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

    const { data, error } = await supabase
      .from('agency_credentials').update(patch).eq('id', body.id).select(listSelect).single()
    if (error) throw new Error(explainDbError(error.message, 'client_records.sql'))
    return NextResponse.json(redact(data))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function DELETE(req: Request) {
  try {
    await requireRole('super_admin')
    const credentialId = new URL(req.url).searchParams.get('credentialId')
    if (!credentialId) return NextResponse.json({ error: 'credentialId is required' }, { status: 400 })

    const { error } = await supabase.from('agency_credentials').delete().eq('id', credentialId)
    if (error) throw new Error(explainDbError(error.message, 'client_records.sql'))
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
