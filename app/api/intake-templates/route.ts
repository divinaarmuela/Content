import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../lib/authz'
import { resolveTemplate, saveTemplateDefinition } from '../../lib/intake'
import { TEMPLATES } from '../../lib/intake-templates'
import { normaliseDefinition, type TemplateKey } from '../../lib/intake-core'

/**
 * The four question templates a new intake form can start from.
 *
 * Managed here rather than as a side effect of editing one client's form:
 * "tailor this for Turnkey" and "change what every ongoing client is asked"
 * are different intentions, and conflating them meant a tickbox could quietly
 * reshape every future form.
 */

const KEYS: TemplateKey[] = ['one_off', 'launch', 'rebrand', 'ongoing']

export async function GET() {
  try {
    await requireRole('editor')

    // which categories have been customised, so the UI can offer a reset that
    // means something rather than one that is always available
    const { data: overrides } = await supabase
      .from('intake_templates').select('key, updated_at, updated_by')
    const byKey = new Map((overrides ?? []).map(o => [o.key as string, o]))

    return NextResponse.json({
      templates: await Promise.all(KEYS.map(async key => {
        const o = byKey.get(key)
        return {
          key,
          name: TEMPLATES[key].name,
          definition: await resolveTemplate(key),
          customised: Boolean(o),
          updated_at: o?.updated_at ?? null,
          updated_by: o?.updated_by ?? null,
        }
      })),
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function PUT(req: Request) {
  try {
    const admin = await requireRole('super_admin')
    const body = await req.json().catch(() => ({}))
    const key = body?.key as TemplateKey
    if (!KEYS.includes(key)) return NextResponse.json({ error: 'Unknown template' }, { status: 400 })

    const definition = normaliseDefinition(body?.definition, key)
    if (definition.sections.length === 0) {
      return NextResponse.json({ error: 'A template needs at least one section' }, { status: 400 })
    }

    await saveTemplateDefinition(key, definition, admin.email)
    return NextResponse.json({ definition })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Reset to the version in intake-templates.ts by deleting the override. That
 *  is the whole undo: the code is always a working fallback. */
export async function DELETE(req: Request) {
  try {
    await requireRole('super_admin')
    const key = new URL(req.url).searchParams.get('key') as TemplateKey
    if (!KEYS.includes(key)) return NextResponse.json({ error: 'Unknown template' }, { status: 400 })

    const { error } = await supabase.from('intake_templates').delete().eq('key', key)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true, definition: TEMPLATES[key] })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
