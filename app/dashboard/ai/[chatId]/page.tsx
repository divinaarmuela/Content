'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import Assistant from '../Assistant'

/**
 * One chat, at its own URL, so a refresh mid-conversation comes back to the
 * conversation. Messages load before the shell renders; a chat that does not
 * exist (deleted, or someone else's) bounces to a fresh chat.
 */
export default function ChatPage() {
  const { chatId } = useParams<{ chatId: string }>()
  const router = useRouter()
  const [messages, setMessages] = useState<unknown[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await fetch(`/api/assistant/chats/${chatId}`)
      if (cancelled) return
      if (!res.ok) {
        toast.error('That chat no longer exists')
        router.replace('/dashboard/ai')
        return
      }
      setMessages((await res.json()).messages ?? [])
    })()
    return () => { cancelled = true }
  }, [chatId, router])

  if (messages === null) {
    return (
      <div className="flex h-[calc(100vh-9rem)] gap-4">
        <Skeleton className="hidden w-56 shrink-0 md:block" />
        <Skeleton className="mx-auto w-full max-w-3xl flex-1" />
      </div>
    )
  }

  return <Assistant chatId={chatId} initialMessages={messages as never} />
}
