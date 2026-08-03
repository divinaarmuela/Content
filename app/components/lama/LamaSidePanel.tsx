'use client'

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from 'react'
import { Scramble } from './Scramble'
import { useExperienceActive, useLamaReady } from './ready'

const CALENDLY = 'https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone'

// the preview rotates through real work footage — intentionally not the
// hero backdrop video
const PREVIEW_VIDEOS = ['/cecconis.mp4', '/Waterside%20Website%20(1).mp4', '/Automodellista.mp4', '/melbourne-junction.mp4']
const ROTATE_MS = 6000

// Reference-site right rail: a fixed column at right-4 top-4 holding a
// translucent contact card (portrait + "Get in touch") with a "This is us"
// tag and a small looping showreel video below it. Desktop only.
export default function LamaSidePanel() {
  const ready = useLamaReady()
  const inExperience = useExperienceActive()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [clip, setClip] = useState(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      videoRef.current?.pause()
      return
    }
    const id = window.setInterval(() => setClip((c) => (c + 1) % PREVIEW_VIDEOS.length), ROTATE_MS)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div
      aria-label="Contact and showreel"
      className={`fixed right-4 top-4 z-[100] hidden lg:flex w-48 flex-col gap-y-1 transition-opacity duration-700 ${ready && !inExperience ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
    >
      <a
        href={CALENDLY}
        target="_blank"
        rel="noreferrer noopener"
        className="group relative flex h-[50px] w-full items-center gap-x-4 overflow-hidden bg-cream/60 px-3 backdrop-blur-sm no-underline"
      >
        <span className="relative block h-7 w-7 shrink-0 overflow-hidden">
          <img src="/martindivina.avif" alt="" className="absolute inset-0 h-full w-full object-cover" />
        </span>
        <Scramble text="Get in touch" className="font-lamam text-[11px] uppercase tracking-widest text-ink" />
      </a>
      <div className="block bg-black/80 backdrop-blur-sm">
        <span className="flex items-center justify-between px-3 py-2.5">
          <Scramble text="This is us" delay={200} className="font-lamam text-[11px] uppercase tracking-widest text-cream" />
          <span className="font-lamam text-[11px] tracking-widest text-cream-dim">( + )</span>
        </span>
        <span className="relative block h-64 w-full overflow-hidden">
          <video
            key={PREVIEW_VIDEOS[clip]}
            ref={videoRef}
            src={PREVIEW_VIDEOS[clip]}
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 h-full w-full object-cover [filter:contrast(1.05)_brightness(0.9)]"
          />
        </span>
      </div>
    </div>
  )
}
