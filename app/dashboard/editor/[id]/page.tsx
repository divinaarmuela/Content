'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useRow } from '@/lib/db-client'
import type { Batch, Client, ContentItem } from '@/lib/db-types'
import { useRole } from '../../useRole'
import PageTitle from '../../ui/PageTitle'
import EditorCardDrawer from '../../board/EditorCardDrawer'
import PostApprovalDetail from '../../board/PostApprovalDetail'
import CardDetail from '../../production/[id]/CardDetail'
import DriveFolderFiles from '../../board/DriveFolderFiles'
import FilesToWorkFrom from '../../board/FilesToWorkFrom'
import { usesMakerDrawer } from '../../../lib/card-sheet-core'
import { workFrom } from '../../../lib/editor-sop-core'

/**
 * A CARD'S OWN PAGE ON THE EDITOR SIDE (the owner, 15 Sep 2026: "make the
 * editor card, when clicked, open a new page displaying the videos'
 * thumbnails so I can view from there" — "not a slider anymore").
 *
 * The board used to open a card in a drawer beside it. Now a press on the
 * Editor page comes here: the files to work from take the wide side — Drive's
 * thumbnails of everything behind the footage folder link, each one playable
 * in place — and the card itself sits beside them: the maker's card for the
 * person holding it (the link box, the checks, the submit, the notes), the
 * manager's card for a manager looking in, the post's card for an uploaded
 * post. The same three cards the drawer chose (card-sheet-core.usesMakerDrawer),
 * on a page instead of a slide-in.
 *
 * Every email and bell link still says /dashboard/editor?card=…; the board
 * turns that into this page.
 */
const folderUrl = (folderId: string) => `https://drive.google.com/drive/folders/${folderId}`

export default function EditorCardPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { me } = useRole()
  const { row: item, loading } = useRow<ContentItem>('content_items', id)
  const { row: shoot } = useRow<Batch>('batches', item?.batch_id ?? null)
  const { row: client } = useRow<Client>('clients', item?.client_id ?? null)
  const back = () => router.push('/dashboard/editor')

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (!item) {
    return (
      <div className="flex flex-col gap-4">
        <PageTitle title="Card not found" summary="It may have been deleted, or the link is not quite right." />
        <Link href="/dashboard/editor" className="inline-flex min-h-11 w-fit items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Editor
        </Link>
      </div>
    )
  }

  const adhoc = (item as { adhoc_post?: unknown }).adhoc_post === true
  const maker = usesMakerDrawer(me, item)
  const frozen = ['scheduled', 'published'].includes(String(item.status))
  const from = workFrom({
    card: item as never, shoot: shoot as never,
    driveFolderUrl: client?.drive_folder_id ? folderUrl(String(client.drive_folder_id)) : null,
  })

  return (
    <div className="flex flex-col gap-4">
      <Link href="/dashboard/editor" className="inline-flex min-h-11 w-fit items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Editor
      </Link>
      <PageTitle
        title={item.title}
        summary={[client?.name, shoot ? `From the shoot: ${shoot.title}` : null].filter(Boolean).join(' · ') || 'A card on the Editor page.'}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,560px)]">
        {/* ── the files, wide: what there is to work from, seen and played here ── */}
        <section className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4" aria-labelledby="ed-page-files">
          <h2 id="ed-page-files" className="text-card-title">Files to work from</h2>
          <p className="text-[13px]">
            <span className="font-semibold">Footage folder: </span>
            {from.footage
              ? <a href={from.footage} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4">Open the Dropbox or Drive folder <ExternalLink className="h-3.5 w-3.5" aria-hidden /><span className="sr-only">, opens in a new tab</span></a>
              : <span className="text-muted-foreground">Not given yet — ask Production.</span>}
          </p>
          {/* Drive's thumbnails of everything behind the link; a press plays it here */}
          <DriveFolderFiles url={from.footage} wide />
          {/* …and the files somebody put straight on the card, if any */}
          <FilesToWorkFrom item={item as never} isManager={!maker && !adhoc && (me?.role === 'account_manager' || me?.role === 'super_admin')} frozen={frozen} linkOnly showFolderFiles={false} />
        </section>

        {/* ── the card itself, beside the files ── */}
        <aside className="min-w-0 overflow-hidden rounded-card border border-border bg-card lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]" aria-label="The card">
          {adhoc
            ? <PostApprovalDetail key={id} id={id} onClose={back} />
            : maker
              ? <EditorCardDrawer key={id} id={id} onClose={back} hideFolderFiles />
              : <CardDetail key={id} id={id} layout="sheet" onClose={back} />}
        </aside>
      </div>
    </div>
  )
}
