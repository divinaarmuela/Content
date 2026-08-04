import { isVideoUrl } from '../lib/media-core'

/** Renders a CMS media URL as a muted looping video or a plain image.
 *  Portrait and landscape both work — parents control the frame and this
 *  fills it with object-fit: cover via the passed className. */
export default function SiteMedia({ src, alt, className }: { src: string; alt: string; className?: string }) {
  if (isVideoUrl(src)) {
    return (
      <video
        src={src}
        autoPlay
        muted
        loop
        playsInline
        aria-label={alt}
        className={className}
      />
    )
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" className={className} />
}
