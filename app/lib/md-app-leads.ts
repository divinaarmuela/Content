import 'server-only'
import { authFor, mdAppReady, mdGraph } from './md-app'
import { IG_WEBHOOK_FIELDS, PAGE_WEBHOOK_FIELDS_MD } from './md-app-core'
import { parseLeadForms, parseLeads, type Lead, type LeadForm } from './md-app-leads-core'

/**
 * MD APP LEADS TAB + LIVE UPDATES — the I/O half (9 Nov 2026). Read only for leads: the client Page's instant forms
 * and each form's leads (Page token; leads_retrieval). Live updates subscribes the client's Page (and Instagram
 * account) to MD App's webhooks — new comments, messages and leads arrive as they happen (pages_manage_metadata).
 */

const { get, post, del, pageAuth, pickedOf } = mdGraph

async function pageCtx(clientId: string) {
  const { auth, picked } = await authFor(clientId)
  const page = pickedOf(picked, 'page')
  const ig = picked.some(r => r.kind === 'instagram') ? pickedOf(picked, 'instagram') : null
  return { auth, page, ig, pa: await pageAuth(auth, page) }
}

export async function leadForms(clientId: string): Promise<LeadForm[]> {
  const { page, pa } = await pageCtx(clientId)
  return parseLeadForms(await get(pa, `${page}/leadgen_forms`, { fields: 'id,name,status,leads_count,created_time', limit: 50 }))
}

export async function formLeads(clientId: string, formId: string): Promise<Lead[]> {
  const { page, pa } = await pageCtx(clientId)
  // the form must be one of this Page's — the Page token is the fence, this is the plain check
  const forms = parseLeadForms(await get(pa, `${page}/leadgen_forms`, { fields: 'id', limit: 100 }))
  if (!forms.some(f => f.id === formId)) throw new Error('That form is not on this client\'s Page')
  return parseLeads(await get(pa, `${formId}/leads`, { fields: 'id,created_time,field_data,ad_name,campaign_name,is_organic', limit: 50 }))
}

/** Is MD App subscribed to the client's Page? (GET /{page}/subscribed_apps lists the apps and their fields) */
export async function liveStatus(clientId: string): Promise<{ on: boolean; fields: string[] }> {
  const { page, pa } = await pageCtx(clientId)
  const appId = mdAppReady().ok ? (mdAppReady() as { env: { appId: string } }).env.appId : null
  const json = await get(pa, `${page}/subscribed_apps`)
  const rows: any[] = Array.isArray(json?.data) ? json.data : []
  const mine = rows.find(r => String(r?.id) === appId)
  return { on: !!mine, fields: Array.isArray(mine?.subscribed_fields) ? mine.subscribed_fields.filter((x: unknown) => typeof x === 'string') : [] }
}

export async function setLive(clientId: string, on: boolean): Promise<{ instagram: string | null }> {
  const { auth, page, ig, pa } = await pageCtx(clientId)
  if (!on) { await del(pa, `${page}/subscribed_apps`); return { instagram: null } }
  await post(pa, `${page}/subscribed_apps`, { subscribed_fields: PAGE_WEBHOOK_FIELDS_MD.join(',') })
  // Instagram: subscribed on the account too where Meta allows it; a refusal is reported, not fatal
  let instagram: string | null = null
  if (ig) await post(auth, `${ig}/subscribed_apps`, { subscribed_fields: IG_WEBHOOK_FIELDS.join(',') }).catch(e => { instagram = e instanceof Error ? e.message : 'failed' })
  return { instagram }
}
