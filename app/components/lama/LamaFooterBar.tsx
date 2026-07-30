'use client'

import { useEffect, useState } from 'react'
import { Scramble } from './Scramble'

function Clock() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    <span className="flex items-center gap-1.5">
      [ <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
      {now ? `${p(now.getHours())} : ${p(now.getMinutes())} : ${p(now.getSeconds())}` : '00 : 00 : 00'} ]
    </span>
  )
}

export default function LamaFooterBar() {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-[90] hidden sm:block bg-ink/80 backdrop-blur-sm">
      <div className="border-t border-cream/10 px-6 py-2.5 flex items-center gap-8 font-lamam text-[11px] uppercase tracking-wider text-cream">
        <Scramble text="EST. 2024" />
        <Scramble text="MELBOURNE BASED" />
        <Clock />
        <span className="ml-auto" />
        <Scramble text="FOLLOW US" className="text-cream-dim" />
        <a href="https://www.instagram.com/mdmedia._" target="_blank" rel="noreferrer noopener" className="hover:text-accent transition-colors">INSTAGRAM +</a>
        <a href="https://www.linkedin.com/company/mdmedia-marketing/" target="_blank" rel="noreferrer noopener" className="hover:text-accent transition-colors">LINKEDIN +</a>
      </div>
    </div>
  )
}
