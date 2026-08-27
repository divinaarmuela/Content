'use client'

import { useState } from 'react'
import { Media, RawFileRow, SlideThumb } from '../../components/media/ItemMedia'

/**
 * The same components the item page mounts, fed the same shape of data as
 * "May Shoot 05" (item 66d3bdde…): one .mov cut whose index is at the end,
 * and three source files. The URLs are the real public R2 objects, so the
 * numbers the smoke script reads off this page are the numbers the page
 * costs a person — override with ?v=<cut url>&raw=<url>,<url>.
 */
const CUT = 'https://pub-e66dd091eb38427e8eaca82bde7082ef.r2.dev/1787810769446-9w7hlt-1787799184142-ejy27l-Vertical_Video.mov'
const RAW = [
  { url: 'https://pub-e66dd091eb38427e8eaca82bde7082ef.r2.dev/1787810304989-nt6te1-A1.mp4', name: 'A1.mp4' },
  { url: 'https://pub-e66dd091eb38427e8eaca82bde7082ef.r2.dev/1787810361350-koa5sc-Website_Landscape_v2.mov', name: 'Website Landscape v2.mov' },
  { url: 'https://pub-e66dd091eb38427e8eaca82bde7082ef.r2.dev/1787811493855-mpaear-A2.mp4', name: 'A2.mp4' },
]

export default function Harness() {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const cut = q?.get('v') || CUT
  const raw = q?.get('raw')
    ? q.get('raw')!.split(',').map(u => ({ url: u, name: u.split('/').pop() ?? u }))
    : RAW
  // a two-slide carousel strip, as the item page draws it under the latest cut
  const slides = [
    { url: cut, name: 'Vertical_Video.mov', type: 'video' as const },
    { url: raw[1]?.url ?? cut, name: 'Website_Landscape_v2.mov', type: 'video' as const },
  ]

  return (
    <div className="dbx mx-auto flex max-w-3xl flex-col gap-4 p-4" data-harness="item-media">
      <h1 className="text-lg font-semibold">Item media harness</h1>
      <p className="text-xs text-zinc-500">Renders the item page&rsquo;s cut preview, slide strip and file rows against the real R2 files.</p>

      <section className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800" data-part="cut">
        <Media key={cut} src={cut} className="max-h-[420px] w-full bg-zinc-950 object-contain" onDims={setDims} />
        <div className="flex gap-2 overflow-x-auto border-t border-zinc-100 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/50" data-part="strip">
          {slides.map((s, i) => (
            <a key={s.url + i} href={s.url} target="_blank" rel="noreferrer noopener"
              className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-950 dark:border-zinc-700">
              <SlideThumb slide={s} />
              <span className="absolute bottom-0 left-0 rounded-tr bg-black/70 px-1 font-mono text-[10px] text-white">{i + 1}</span>
            </a>
          ))}
        </div>
        <p className="p-3 text-xs text-zinc-500">{dims ? `${dims.w} × ${dims.h}` : 'no dimensions yet'}</p>
      </section>

      <section className="flex flex-col gap-1.5 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" data-part="files">
        {raw.map(a => <RawFileRow key={a.url} file={a} canManage={false} />)}
      </section>
    </div>
  )
}
