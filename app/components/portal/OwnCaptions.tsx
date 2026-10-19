/**
 * The networks that post DIFFERENT WORDS from the caption shown (19 Oct 2026,
 * `ownCaptions` in portal-core). A client approves a post once for every
 * network, so each network's own words are in front of them when they do.
 */
export default function OwnCaptions({
  captions, except, className,
}: {
  captions: readonly { platform: string; network: string; caption: string }[] | undefined
  /** the network whose words are already on screen (its preview frame) */
  except?: string | null
  className?: string
}) {
  const rows = (captions ?? []).filter(c => c.platform !== except)
  if (rows.length === 0) return null
  return (
    <div className={className} data-own-captions>
      {rows.map(c => (
        <div key={c.platform} className="mt-3 rounded-inner border border-border p-3">
          <p className="text-[12px] font-semibold text-muted-foreground">Words on {c.network}</p>
          <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed">{c.caption}</p>
        </div>
      ))}
    </div>
  )
}
