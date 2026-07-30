'use client'

import { useEffect, useRef } from 'react'

export default function FrameSequenceBg({
  base,
  count,
  containerRef,
}: {
  base: string
  count: number
  containerRef: React.RefObject<HTMLElement | null>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1

    // Canvas backing store = physical pixels; draw in logical pixels via transform
    const sizeCanvas = () => {
      canvas.width  = window.innerWidth  * dpr
      canvas.height = window.innerHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    sizeCanvas()
    window.addEventListener('resize', sizeCanvas)

    // Preload every frame up front — held in closure so GC never evicts them
    const frames: HTMLImageElement[] = Array.from({ length: count }, (_, i) => {
      const img = new Image()
      img.src = `${base}${String(i + 1).padStart(4, '0')}.webp`
      return img
    })

    // Cover-fill draw: always fills viewport without distortion (like object-fit:cover)
    const drawCover = (img: HTMLImageElement) => {
      const iw = img.naturalWidth
      const ih = img.naturalHeight
      const cw = window.innerWidth
      const ch = window.innerHeight
      const scale = Math.max(cw / iw, ch / ih)
      const sw = iw * scale
      const sh = ih * scale
      ctx.drawImage(img, (cw - sw) / 2, (ch - sh) / 2, sw, sh)
    }

    const draw = (progress: number) => {
      const idx = Math.min(count - 1, Math.floor(progress * count))
      const img = frames[idx]
      if (img.complete && img.naturalWidth > 0) drawCover(img)
    }

    frames[0].complete ? draw(0) : (frames[0].onload = () => draw(0))

    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const container = containerRef.current
        if (!container) return

        const totalH = container.offsetHeight
        const progress = Math.max(0, Math.min(1, window.scrollY / totalH))
        draw(progress)

        // Fade out once the container has fully left the top of the viewport
        const rect = container.getBoundingClientRect()
        canvas.style.opacity = rect.bottom > 0 ? '1' : '0'
      })
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', sizeCanvas)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [base, count, containerRef])

  return (
    <canvas
      ref={canvasRef}
      className="frame-seq-fixed-bg"
      aria-hidden="true"
    />
  )
}
