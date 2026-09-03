'use client'

import Link from 'next/link'
import { HelpCircle } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { GLOSSARY, type GlossaryKey } from '@/app/lib/glossary-core'

/**
 * A `?` after a word this app invented. Tap it, read what the word means.
 *
 * Deliberately NOT a `title=` attribute and NOT a hover tooltip: a meaningful
 * share of this team works from a phone, where hover never fires, and every
 * piece of contextual help in the dashboard used to be hover-only. This opens
 * on click/tap, which works with a mouse, a finger and a keyboard alike.
 *
 * Built on the DropdownMenu primitive because that is the click-opened,
 * portalled, dark-mode-correct popover this project already ships — adding a
 * second Radix package for the same behaviour would only be more to keep in
 * sync.
 */
export default function HelpHint({ term, className }: { term: GlossaryKey; className?: string }) {
  const { title, body } = GLOSSARY[term]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          // 44px of tappable area around a 14px glyph — the icon can look
          // small, the target cannot be small.
          className={`-m-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full p-2 align-middle text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/25 ${className ?? ''}`}
          aria-label={`What does "${title}" mean?`}
          onClick={e => e.stopPropagation()}
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-[18rem] p-3">
        <p className="text-body-15 font-medium">{title}</p>
        <p className="mt-1 text-secondary-13 leading-relaxed text-muted-foreground">{body}</p>
        <Link
          href="/dashboard/settings/glossary"
          className="mt-2 inline-block text-secondary-13 font-medium text-accent-blue-deep hover:underline"
        >
          See all the words →
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
