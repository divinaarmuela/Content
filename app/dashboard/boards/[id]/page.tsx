'use client'

import { useParams } from 'next/navigation'
import BoardCanvas from '../BoardCanvas'

/** One board, full page. Nested boards open here too — the breadcrumbs
 *  climb back up, and the first crumb goes back to the Boards list. */
export default function BoardPage() {
  const { id } = useParams<{ id: string }>()
  return (
    <div className="dbx-board">
      <BoardCanvas boardId={id} backHref={{ href: '/dashboard/boards', label: 'Boards' }} />
    </div>
  )
}
