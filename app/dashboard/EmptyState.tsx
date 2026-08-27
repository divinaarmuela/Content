'use client'

import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

/**
 * "There is nothing here" — with the thing you do about it.
 *
 * Thirteen of the app's seventeen empty states were a grey sentence and no
 * button, so the answer to "what now?" was to go and ask a colleague. Four got
 * it right; the Clients one is the model this copies: say what the list is
 * for, then offer the action that fills it.
 *
 * `action` is optional only for lists a person genuinely cannot fill from
 * where they are standing — a feed of things other people do.
 */
export default function EmptyState({
  icon: Icon, title, body, actionLabel, onAction, actionHref, className,
}: {
  icon?: LucideIcon
  /** what is empty, in four or five words */
  title: string
  /** why it is empty and what fills it */
  body: string
  actionLabel?: string
  onAction?: () => void
  actionHref?: string
  className?: string
}) {
  return (
    <Card className={`border-dashed shadow-none ${className ?? ''}`}>
      <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        {Icon && (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
            <Icon className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
          </div>
        )}
        <div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{title}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">{body}</p>
        </div>
        {actionLabel && (actionHref
          ? <Button size="sm" variant="outline" asChild><a href={actionHref}>{actionLabel}</a></Button>
          : <Button size="sm" variant="outline" onClick={onAction}>{actionLabel}</Button>
        )}
      </CardContent>
    </Card>
  )
}
