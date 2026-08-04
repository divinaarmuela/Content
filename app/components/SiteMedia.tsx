import { isVideoUrl } from '../lib/media-core'

/**
 * Renders a CMS media URL as a muted looping video or a plain image.
 *
 * Videos autoplay silently everywhere — no controls, no play badge. The motion
 * is the design.
 *
 * Portrait and landscape both work; parents control the frame and this fills
 * it via object-fit in the passed className.
 *
 * Worth knowing: autoplay means the browser downloads the file to play it, so
 * a large master is paid for by every visitor. Compress anything public-facing
 * before upload — the storage limit is 5GB, but the page has no such patience.
 */
export default function SiteMedia({
  src, alt, className, poster, autoPlay = true,
}: {
  src: string
  alt: string
  className?: string
  /** Still shown before playback. Without one the first frame is used. */
  poster?: string
  autoPlay?: boolean
}) {
  if (isVideoUrl(src)) {
    return (
      <video
        src={src}
        poster={poster}
        preload={autoPlay ? 'auto' : 'metadata'}
        autoPlay={autoPlay}
        loop
        muted
        // without this iOS Safari throws the video fullscreen on play
        playsInline
        aria-label={alt}
        className={className}
      />
    )
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" className={className} />
}
