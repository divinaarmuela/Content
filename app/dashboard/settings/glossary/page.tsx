'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { GLOSSARY, GLOSSARY_KEYS } from '@/app/lib/glossary-core'

/**
 * Every word this app invented, on one page.
 *
 * The `?` popovers explain a word where you meet it; this is the place you go
 * when somebody said one out loud and you have no idea what they meant. Same
 * source, so a definition cannot exist in two versions.
 */
export default function GlossaryPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">What the words mean</CardTitle>
        <CardDescription>
          This app has its own vocabulary. Nobody is expected to arrive knowing
          it — here it is, in one place.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
          {GLOSSARY_KEYS.map(key => (
            <div key={key} className="grid gap-1 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
              <dt className="text-sm font-medium">{GLOSSARY[key].title}</dt>
              <dd className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                {GLOSSARY[key].body}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}
