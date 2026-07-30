'use client'

import { useEffect, useRef, useState } from 'react'

// Fixed full-viewport video layer that sits behind every section, with the
// halftone dot pattern rendered on top of it (mirrors the reference site's
// fixed backdrop-item structure). Placeholder stock video until MD Media
// footage is supplied — swap VIDEO_SRC only.
const VIDEO_SRC = 'https://videos.pexels.com/video-files/3129671/3129671-uhd_2560_1440_30fps.mp4'

export default function LamaBackdrop() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      videoRef.current?.pause()
    }
  }, [])

  return (
    <div aria-hidden="true" className="fixed inset-0 z-0 pointer-events-none bg-ink">
      {!failed && (
        <video
          ref={videoRef}
          src={VIDEO_SRC}
          autoPlay
          muted
          loop
          playsInline
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover opacity-40"
        />
      )}
      {/* halftone dots + darkening sit above the video, like the reference */}
      <div className="absolute inset-0 bg-lama-dots [background-size:4px_4px]" />
      <div className="absolute inset-0 bg-ink/55" />
    </div>
  )
}
