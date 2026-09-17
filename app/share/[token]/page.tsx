import type { Metadata } from 'next'
import { table } from '@/lib/db'
import type { Client, ContentItem, DrivePull } from '@/lib/db-types'
import { isShareToken, maySharePublicly, sharedFilesOf, shareWords } from '../../lib/share-link-core'
import { downloadHref } from '../../lib/download-core'
import { roundOf } from '../../lib/edit-round-core'

/**
 * THE PUBLIC SHARE PAGE (share-link-core): the accepted version's files, each
 * with a Download, for anyone holding the link. No sign-in — the route
 * allowlist in middleware.ts leaves /share public on purpose. Nothing here
 * is editable and nothing else on the card is shown.
 */
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Shared files — MD Media', robots: { index: false, follow: false } }

function sizeWords(bytes: number | null): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const item = isShareToken(token)
    ? (await table<ContentItem>('content_items').list({ where: r => (r as { share_token?: unknown }).share_token === token, limit: 1 }))[0] ?? null
    : null
  const live = !!item && maySharePublicly(item.status)
  const [client, pulls] = live
    ? await Promise.all([
      item.client_id ? table<Client>('clients').get(String(item.client_id)) : Promise.resolve(null),
      table<DrivePull>('drive_pulls').list({ by: { scope_id: item.id } as never }),
    ])
    : [null, []]
  const files = live ? sharedFilesOf(item as never, pulls as never) : []
  const version = live ? roundOf(item) : 1

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 20px', fontFamily: 'system-ui, sans-serif' }}>
      {!live ? (
        <>
          <h1 style={{ fontSize: 24, margin: '0 0 8px' }}>This link has been switched off</h1>
          <p style={{ margin: 0, opacity: 0.7 }}>Ask the person who sent it for a new one.</p>
        </>
      ) : (
        <>
          <p style={{ margin: '0 0 6px', fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.6 }}>{client?.name ?? 'MD Media'}</p>
          <h1 style={{ fontSize: 26, margin: '0 0 8px' }}>{item.title}</h1>
          <p style={{ margin: '0 0 24px', opacity: 0.75 }}>{shareWords(files, version)}</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {files.map(f => {
              const href = downloadHref(f, token)
              return (
                <li key={f.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, border: '1px solid rgba(0,0,0,0.12)', borderRadius: 14, padding: '12px 16px' }}>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ fontWeight: 600 }}>{f.name}</span>
                    {sizeWords(f.size) && <span style={{ marginLeft: 8, fontSize: 13, opacity: 0.6 }}>{sizeWords(f.size)}</span>}
                  </span>
                  {href && (
                    <a href={href} download={f.name}
                      style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', minHeight: 40, padding: '0 16px', borderRadius: 999, background: '#111', color: '#fff', textDecoration: 'none', fontWeight: 600, fontSize: 14 }}>
                      Download
                    </a>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </main>
  )
}
