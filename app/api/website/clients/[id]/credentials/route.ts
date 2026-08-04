import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { encryptSecret, decryptSecret, credentialsKeyConfigured } from '@/app/lib/secret-box'

/**
 * Client platform credentials.
 *
 * These are other people's passwords, so the rules here are deliberately
 * tighter than elsewhere:
 *
 * - The secret is encrypted before it reaches the database and is NEVER
 *   included in a list response. Listing shows platform, username and URL,
 *   which are not secret and are what you actually need to scan.
 * - Revealing one is an explicit, separate request for a single credential,
 *   restricted to super_admin. Everyone else can see that a login exists and
 *   who owns it without being handed it.
 * - Every write records who made it. For something this sensitive, "who last
 *   touched this" is the minimum useful audit trail.
 */

const listSelect = 'id,client_id,platform,label,username,url,notes,updated_at,updated_by_name,secret_cipher'

/** Strip the ciphertext, keep a flag so the UI can show whether one exists. */
const redact = (row: Record<string, unknown>) => {
  const { secret_cipher, ...rest } = row
  return { ...rest, has_secret: Boolean(secret_cipher) }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole('account_manager')
    const { id } = await params
    const { data, error } = await supabase
      .from('client_credentials')
      .select(listSelect)
      .eq('client_id', id)
      .order('platform', { ascending: true })
    if (error) throw new Error(error.message)
    return NextResponse.json((data ?? []).map(redact))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireRole('account_manager')
    const { id } = await params
    const body = await req.json()

    // ── reveal one secret ──
    if (body.action === 'reveal') {
      // deliberately stricter than reading the list
      await requireRole('super_admin')
      if (!body.credentialId) {
        return NextResponse.json({ error: 'credentialId is required' }, { status: 400 })
      }
      const { data, error } = await supabase
        .from('client_credentials')
        .select('secret_cipher')
        .eq('id', body.credentialId)
        .single()
      if (error) throw new Error(error.message)
      if (!data?.secret_cipher) return NextResponse.json({ secret: '' })

      try {
        return NextResponse.json({ secret: decryptSecret(data.secret_cipher) })
      } catch {
        // a rotated or mistyped CREDENTIALS_KEY cannot decrypt what an older
        // one wrote, and silently returning nothing would look like data loss
        return NextResponse.json(
          { error: 'Could not decrypt — CREDENTIALS_KEY may have changed since this was saved.' },
          { status: 500 },
        )
      }
    }

    // ── create ──
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
      .from('client_credentials')
      .insert({
        client_id: id,
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

    if (error) throw new Error(error.message)
    return NextResponse.json(redact(data), { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function PATCH(req: Request) {
  try {
    const me = await requireRole('account_manager')
    const body = await req.json()
    if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const patch: Record<string, unknown> = {
      updated_by: me.id,
      updated_by_name: me.name || me.email,
    }
    for (const k of ['platform', 'label', 'username', 'url', 'notes']) {
      if (k in body) patch[k] = body[k]
    }
    // only touch the secret when one was actually submitted: an empty field in
    // an edit form means "leave it alone", not "erase the password"
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
      .from('client_credentials').update(patch).eq('id', body.id).select(listSelect).single()
    if (error) throw new Error(error.message)
    return NextResponse.json(redact(data))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function DELETE(req: Request) {
  try {
    await requireRole('account_manager')
    const credentialId = new URL(req.url).searchParams.get('credentialId')
    if (!credentialId) return NextResponse.json({ error: 'credentialId is required' }, { status: 400 })

    const { error } = await supabase.from('client_credentials').delete().eq('id', credentialId)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
