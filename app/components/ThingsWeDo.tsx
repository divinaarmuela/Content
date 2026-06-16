'use client'

import { useEffect, useRef } from 'react'

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$&*()-_+=/0123456789'
const rand = (arr: string) => arr[Math.floor(Math.random() * arr.length)]

// Same glitch-typewriter used by ServicesNav — types the final text out one
// char at a time behind a flickering blue/black cursor block.
function typewriterText(el: HTMLElement, finalText: string, speed = 45) {
  el.style.minHeight = el.offsetHeight + 'px'

  let index = 0
  let done = false

  const glitchCursor = () =>
    `<span class="tw-cursor" aria-hidden="true" style="background:${Math.random() > 0.55 ? '#298dff' : '#0c0c0c'}">${rand(CHARS)}</span>`

  const renderFull = () => {
    const html = finalText.slice(0, index).replace(/\n/g, '<br>')
    el.innerHTML = html + glitchCursor()
  }

  renderFull()

  const typingInterval = setInterval(() => {
    index++
    if (index >= finalText.length) {
      clearInterval(typingInterval)
      done = true
      el.innerHTML = finalText.replace(/\n/g, '<br>')
      el.style.minHeight = ''
    } else {
      renderFull()
    }
  }, speed)

  const cursorInterval = setInterval(() => {
    if (done) { clearInterval(cursorInterval); return }
    const cursor = el.querySelector<HTMLSpanElement>('.tw-cursor')
    if (cursor) {
      cursor.textContent = rand(CHARS)
      cursor.style.background = Math.random() > 0.55 ? '#298dff' : '#0c0c0c'
    }
  }, 60)
}

const processSteps = [
  {
    phase: 'Phase 1',
    title: 'Brand Diagnosis',
    desc: 'We audit your brand, competitors, and audience. Map the gap between where you are and where the market needs you to be. No guessing. Data and instinct combined.',
  },
  {
    phase: 'Phase 2',
    title: 'Story Architecture',
    desc: 'Build your content pillars, hook library, and funnel scripts. Every piece of content maps to a business outcome. Strategy before a single frame is shot.',
  },
  {
    phase: 'Phase 3',
    title: 'Production Engine',
    desc: 'Monthly shoots, professional editing, and a content pipeline that runs without you chasing it. Your dedicated pod handles everything from brief to publish.',
  },
  {
    phase: 'Phase 4',
    title: 'Growth Amplification',
    desc: 'Your best organic content becomes your paid ads engine. We insert CTAs, run paid ads, and let proven content do the selling at scale.',
  },
]

export default function ThingsWeDo() {
  const titleRefs = useRef<(HTMLHeadingElement | null)[]>([])
  const triggered = useRef<boolean[]>(Array(processSteps.length).fill(false))

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const idx = titleRefs.current.findIndex(el => el === entry.target)
          if (idx === -1 || triggered.current[idx] || !entry.isIntersecting) return
          triggered.current[idx] = true
          setTimeout(() => {
            const el = entry.target as HTMLHeadingElement
            el.style.visibility = 'visible'
            typewriterText(el, processSteps[idx].title)
          }, idx * 100)
        })
      },
      { threshold: 0.3 }
    )
    titleRefs.current.forEach(el => el && io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <section
      id="process"
      className="border-0 bg-white py-[clamp(72px,12vh,160px)] text-[#0c0c0c]"
    >
      <div className="px-[clamp(20px,6vw,80px)]">
        <p className="mb-[clamp(36px,7vh,72px)] font-mono text-[11px] uppercase tracking-[0.22em] text-black/45">
          &middot; What We Do
        </p>
        <h2 className="mb-[clamp(40px,7vh,80px)] font-sans font-medium leading-[1.05] tracking-[-0.03em] text-[clamp(34px,5.5vw,76px)]">
          Things We Do
        </h2>
        <div className="border-b border-solid border-[#0c0c0c]">
          {processSteps.map((step, i) => (
            <div
              key={i}
              className="group relative flex flex-col gap-4 overflow-hidden border-t border-solid border-[#0c0c0c] px-[clamp(14px,2vw,40px)] py-[clamp(28px,4vh,52px)] transition-colors duration-500 hover:text-white md:flex-row md:items-start md:justify-between md:gap-[clamp(40px,8vw,140px)]"
            >
              {/* black panel that slides down on hover, with a drifting blue blob */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-[#0c0c0c] [transform:translateY(-100%)] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:[transform:translateY(0)]"
              >
                <span
                  className="blob absolute left-0 top-1/2 -mt-[14vw] h-[28vw] w-[28vw] rounded-full bg-[radial-gradient(circle,#0057ff_0%,transparent_65%)] opacity-60"
                  style={{
                    animationName: i % 2 === 0 ? 'blobdrift' : 'blobdrift2',
                    animationDuration: `${13 + i * 2.4}s`,
                    animationDelay: `-${i * 3.7}s`,
                    animationTimingFunction: 'ease-in-out',
                    animationIterationCount: 'infinite',
                    animationDirection: i % 3 === 0 ? 'normal' : 'alternate',
                  }}
                />
              </div>
              <div className="relative z-10 md:flex-1">
                <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-[#0057FF]">
                  {step.phase}
                </span>
                <h3
                  ref={el => { titleRefs.current[i] = el }}
                  className="mt-2 font-sans font-medium leading-[1.05] tracking-[-0.02em] text-[clamp(28px,4vw,56px)] transition-colors duration-500 [visibility:hidden]"
                >
                  {step.title}
                </h3>
              </div>
              <p className="relative z-10 font-sans leading-[1.55] text-black/65 text-[clamp(15px,1.3vw,19px)] transition-colors duration-500 group-hover:text-white/70 md:max-w-[44ch] md:flex-1">
                {step.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
