'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Info, SendHorizontal, Sparkles } from 'lucide-react'

type Message = {
  id: number
  role: 'assistant' | 'user'
  text: string
  time: string
}

const DEMO_MESSAGES: Message[] = [
  {
    id: 1,
    role: 'assistant',
    text: "Hi! I'm the MD Media assistant. I can draft shoot briefs, summarise client performance, flag overdue approvals, and write status updates.",
    time: '09:00',
  },
  {
    id: 2,
    role: 'user',
    text: 'Summarise May performance for Harbourline Cafe.',
    time: '09:02',
  },
  {
    id: 3,
    role: 'assistant',
    text: 'Harbourline Cafe reached 48.2k accounts in May, up 12% month on month. Reels drove most of the growth; two approvals are still pending for the June calendar.',
    time: '09:02',
  },
  {
    id: 4,
    role: 'user',
    text: 'Draft a shoot brief for the June menu launch.',
    time: '09:05',
  },
  {
    id: 5,
    role: 'assistant',
    text: 'Here is a starting point: a 2-hour on-location shoot covering 6 hero dishes, 3 behind-the-scenes clips for Reels, and a set of vertical stills for Stories. Want me to expand any section?',
    time: '09:05',
  },
]

export default function AIPage() {
  const [input, setInput] = useState('')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">AI Assistant</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Draft briefs, summarise performance, and flag blockers.
          </p>
        </div>
        <Badge
          variant="outline"
          className="ml-auto font-mono text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500"
        >
          Demo data
        </Badge>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
        <Info className="h-4 w-4 shrink-0" />
        Assistant not yet connected — UI preview
      </div>

      <Card className="border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-3">
          <Sparkles className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
          <CardTitle className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Conversation
          </CardTitle>
          <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
            Preview
          </span>
        </CardHeader>
        <Separator className="bg-zinc-200 dark:bg-zinc-800" />
        <CardContent className="p-0">
          <ScrollArea className="h-[420px]">
            <div className="flex flex-col gap-4 p-4">
              {DEMO_MESSAGES.map((message) => (
                <div
                  key={message.id}
                  className={
                    message.role === 'user'
                      ? 'flex flex-col items-end gap-1'
                      : 'flex flex-col items-start gap-1'
                  }
                >
                  <div
                    className={
                      message.role === 'user'
                        ? 'max-w-[80%] rounded-lg bg-zinc-900 dark:bg-zinc-100 p-3 text-sm text-white dark:text-zinc-900'
                        : 'max-w-[80%] rounded-lg bg-zinc-100 dark:bg-zinc-800 p-3 text-sm text-zinc-900 dark:text-zinc-100'
                    }
                  >
                    {message.text}
                  </div>
                  <span className="font-mono text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
                    {message.time}
                  </span>
                </div>
              ))}
            </div>
          </ScrollArea>
          <Separator className="bg-zinc-200 dark:bg-zinc-800" />
          <div className="flex items-end gap-2 p-4">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about clients, content, approvals, reports..."
              className="min-h-[44px] flex-1 resize-none border-zinc-200 dark:border-zinc-800 text-sm"
              rows={2}
            />
            <Button disabled className="shrink-0">
              <SendHorizontal className="h-4 w-4" />
              Send
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
