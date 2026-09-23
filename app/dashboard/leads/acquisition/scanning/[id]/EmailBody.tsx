'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { bodyView, emailFrameDocument, type BodyToken } from '../../../../../lib/acq-conversation-core'
import { prepareEmailHtml } from '../../../../../lib/email-html-client'

/**
 * ONE EMAIL, DRAWN THE WAY A MAIL CLIENT DRAWS IT (research, 23 Sep 2026;
 * the owner: "the inbox design is not great sometimes there are links a lot
 * of flaw in the design"). HTML mail goes through DOMPurify and into a
 * sandboxed iframe with no scripts and its own Content-Security-Policy, sized
 * to its content. Remote images stay blocked until "Show images" — every
 * loaded image is a tracking pixel. The quoted history the sender's client
 * marked is folded under "Show earlier messages". Plain-text mail is
 * unwrapped into paragraphs with short, clickable links.
 */
function Frame({ html, minHeight = 40 }: { html: string; minHeight?: number }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(minHeight)
  const doc = useMemo(() => emailFrameDocument(html), [html])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let ro: ResizeObserver | null = null
    const measure = () => {
      const body = el.contentDocument?.body
      if (!body) return
      setHeight(Math.max(minHeight, Math.min(body.scrollHeight + 8, 20000)))
    }
    const onLoad = () => {
      measure()
      const body = el.contentDocument?.body
      if (body && 'ResizeObserver' in window) { ro = new ResizeObserver(measure); ro.observe(body) }
    }
    el.addEventListener('load', onLoad)
    // srcdoc may already be parsed by the time the effect runs
    if (el.contentDocument?.readyState === 'complete' && el.contentDocument.body?.childElementCount) onLoad()
    return () => { el.removeEventListener('load', onLoad); ro?.disconnect() }
  }, [doc, minHeight])
  return (
    <iframe ref={ref} title="Email" srcDoc={doc} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer" style={{ height }} className="block w-full border-0 bg-white" />
  )
}

function Tokens({ tokens }: { tokens: BodyToken[] }) {
  return <>{tokens.map((t, i) => t.kind === 'text'
    ? <span key={i}>{t.text}</span>
    : <a key={i} href={t.href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent-blue-deep underline underline-offset-4 break-all">{t.label}</a>)}</>
}

export default function EmailBody({ html, text }: { html: string | null; text: string }) {
  const [images, setImages] = useState(false)
  const [showQuoted, setShowQuoted] = useState(false)
  const prepared = useMemo(() => (html ? prepareEmailHtml(html, { images }) : null), [html, images])
  const plain = useMemo(() => (html ? null : bodyView(text)), [html, text])

  return (
    <div className="mt-3" data-email-body>
      {prepared ? (
        <>
          {prepared.blockedImages > 0 && (
            <button type="button" onClick={() => setImages(true)} className="mb-2 inline-flex h-8 items-center rounded-full border border-border px-3 text-[12px] font-semibold hover:bg-foreground/[0.04]">
              Show {prepared.blockedImages === 1 ? 'the image' : `${prepared.blockedImages} images`}
            </button>
          )}
          <div className="overflow-hidden rounded-inner border border-border bg-white"><Frame html={prepared.own} /></div>
          {prepared.quoted && (
            <div className="mt-2">
              <button type="button" onClick={() => setShowQuoted(v => !v)} aria-expanded={showQuoted} className="inline-flex h-8 items-center rounded-full border border-border px-3 text-[12px] font-semibold text-muted-foreground hover:bg-foreground/[0.04]">
                {showQuoted ? 'Hide earlier messages' : '··· Show earlier messages'}
              </button>
              {showQuoted && <div className="mt-2 overflow-hidden rounded-inner border border-dashed border-border bg-white opacity-90"><Frame html={prepared.quoted} /></div>}
            </div>
          )}
        </>
      ) : plain && (
        <>
          <div className="flex flex-col gap-3 text-[14px] leading-relaxed">
            {plain.paragraphs.map((p, i) => <p key={i} className="whitespace-pre-wrap"><Tokens tokens={p} /></p>)}
          </div>
          {plain.quoted && (
            <div className="mt-3">
              <button type="button" onClick={() => setShowQuoted(v => !v)} aria-expanded={showQuoted} className="inline-flex h-8 items-center rounded-full border border-border px-3 text-[12px] font-semibold text-muted-foreground hover:bg-foreground/[0.04]">
                {showQuoted ? 'Hide earlier messages' : '··· Show earlier messages'}
              </button>
              {showQuoted && <pre className="mt-2 whitespace-pre-wrap border-l-2 border-border pl-3 font-sans text-[13px] text-muted-foreground">{plain.quoted}</pre>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
