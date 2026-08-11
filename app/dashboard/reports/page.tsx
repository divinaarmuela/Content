'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ArrowDownRight, ArrowUpRight, FileDown, Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import LeadsReportCard from './LeadsReportCard'

const TREND_DATA = [
  { week: 'W1', reach: 18200, engagement: 1230 },
  { week: 'W2', reach: 22400, engagement: 1680 },
  { week: 'W3', reach: 19800, engagement: 1410 },
  { week: 'W4', reach: 21200, engagement: 1800 },
]

const PLATFORM_DATA = [
  { name: 'Instagram', reach: 34200, engagement: 2900, clicks: 820 },
  { name: 'TikTok',    reach: 28600, engagement: 1840, clicks: 540 },
  { name: 'Facebook',  reach: 11200, engagement: 780,  clicks: 260 },
  { name: 'LinkedIn',  reach: 7600,  engagement: 600,  clicks: 150 },
]

const CLIENTS = ['All Clients', 'Apex Fitness', 'Bloom Skincare', 'Align Wellness', 'Surge Coffee']

const METRICS = [
  { label: 'Total Reach',     value: '81,600', delta: '+12% vs Apr', up: true  },
  { label: 'Engagements',     value: '6,120',  delta: '+8% vs Apr',  up: true  },
  { label: 'Link Clicks',     value: '1,770',  delta: '-3% vs Apr',  up: false },
  { label: 'Follower Growth', value: '+847',   delta: 'across all',  up: true  },
]

export default function ReportsPage() {
  const [client, setClient] = useState('All Clients')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Reports</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Performance snapshot — May 2026.</p>
        </div>
        <Badge
          variant="outline"
          className="ml-auto font-mono text-[11px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500"
        >
          Demo data
        </Badge>
      </div>

      <LeadsReportCard />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={client} onValueChange={v => setClient(v ?? 'All Clients')}>
          <SelectTrigger className="w-48 bg-white dark:bg-zinc-900">
            <SelectValue placeholder="Select client" />
          </SelectTrigger>
          <SelectContent>
            {CLIENTS.map(c => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => toast.loading('Generating PDF…', { duration: 2000 })}
          >
            <FileDown className="h-4 w-4" />
            Export PDF
          </Button>
          <Button
            size="sm"
            onClick={() =>
              toast.success('Report sent', {
                description: `Sent to ${client === 'All Clients' ? 'all clients' : client}.`,
              })
            }
          >
            <Send className="h-4 w-4" />
            Send to client
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {METRICS.map(m => (
          <Card key={m.label} className="border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <CardHeader className="pb-2">
              <CardTitle className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
                {m.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-mono text-3xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                {m.value}
              </p>
              <p
                className={`mt-1 flex items-center gap-1 text-xs ${
                  m.up ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                }`}
              >
                {m.up ? (
                  <ArrowUpRight className="h-4 w-4" />
                ) : (
                  <ArrowDownRight className="h-4 w-4" />
                )}
                {m.delta}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Reach &amp; engagement trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={TREND_DATA} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                <XAxis
                  dataKey="week"
                  stroke="#a1a1aa"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="#a1a1aa"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 8,
                    fontSize: 12,
                    color: 'hsl(var(--card-foreground))',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="reach"
                  name="Reach"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="engagement"
                  name="Engagement"
                  stroke="#a1a1aa"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
            <div className="mt-2 flex items-center gap-4">
              <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
                Reach
              </span>
              <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
                Engagement
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Platform breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
                    Platform
                  </TableHead>
                  <TableHead className="text-right font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
                    Reach
                  </TableHead>
                  <TableHead className="text-right font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
                    Engagement
                  </TableHead>
                  <TableHead className="text-right font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
                    Clicks
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {PLATFORM_DATA.map(p => (
                  <TableRow key={p.name}>
                    <TableCell className="font-medium text-zinc-900 dark:text-zinc-100">{p.name}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-zinc-700 dark:text-zinc-200">
                      {p.reach.toLocaleString('en-US')}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-zinc-700 dark:text-zinc-200">
                      {p.engagement.toLocaleString('en-US')}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-zinc-700 dark:text-zinc-200">
                      {p.clicks.toLocaleString('en-US')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className="border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Report commentary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            className="min-h-24 resize-y bg-zinc-50 dark:bg-zinc-900 text-sm leading-relaxed text-zinc-700 dark:text-zinc-200"
            defaultValue="May showed strong reach performance across Instagram and TikTok, with engagement up 8% month-on-month. Link clicks dipped slightly — recommend A/B testing CTA copy in June."
          />
        </CardContent>
      </Card>
    </div>
  )
}
