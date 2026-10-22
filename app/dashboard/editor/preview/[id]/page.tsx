'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import PageTitle from '../../../ui/PageTitle'

/** THE PREVIEW'S CARD PAGE MOVED: the new Editor card is the Editor card now (the owner, 22 Oct 2026) */
export default function EditorPreviewCardMoved() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  useEffect(() => { router.replace(`/dashboard/editor/${id}`) }, [id, router])
  return <PageTitle title="Opening the card…" summary="The new Editor card is the Editor card now." />
}
