import { ExternalLink } from 'lucide-react'
import { linkParts } from '../lib/todo-core'

/**
 * WORDS WITH THEIR LINKS PRESSABLE (29 Oct 2026: "when we input it in the shoots will it come out as hyperlink? like
 * the input fields"). Every address in the words opens in a new tab; everything else is drawn as it was. Built as
 * elements, never as HTML, so nothing typed can run.
 */
export function LinkedText({ text, className = '' }: { text: string; className?: string }) {
  return (
    <>
      {linkParts(String(text ?? '')).map((p, i) => p.href
        ? <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
            className={`break-all text-accent-blue-deep underline underline-offset-2 hover:text-accent-blue ${className}`}>{p.text}</a>
        : <span key={i}>{p.text}</span>)}
    </>
  )
}

/**
 * The links in a field, under it — a box being typed in cannot hold a link that opens, so each address it holds is
 * shown beneath it, pressable. Nothing when there are none.
 */
export function LinksIn({ text, className = '' }: { text: string | null | undefined; className?: string }) {
  const links = [...new Map(linkParts(String(text ?? '')).filter(p => p.href).map(p => [p.href!, p])).values()]
  if (links.length === 0) return null
  return (
    <span className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] ${className}`}>
      {links.map(l => (
        <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer"
          className="inline-flex max-w-full items-center gap-1 truncate text-accent-blue-deep underline underline-offset-2 hover:text-accent-blue">
          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{l.text.replace(/^https?:\/\//, '')}</span>
        </a>
      ))}
    </span>
  )
}
