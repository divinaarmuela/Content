'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ArrowRight, Inbox, Users, Globe, ExternalLink, TrendingUp } from 'lucide-react'

type Lead = { id: string; created_at: string; fname: string; lname: string; biz: string; model: string }
type Project = { id: string; name: string; slug: string; published: boolean }
type Client = { id: string; name: string; status: string }

function Stat({ label, value, hint, loading, icon: Icon }: {
  label: string; value: string | number; hint?: string; loading: boolean
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">{label}</p>
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-50 dark:bg-blue-950/40">
            <Icon className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
          </div>
        </div>
        {loading
          ? <Skeleton className="mt-2 h-8 w-16" />
          : <p className="mt-1 font-mono text-3xl font-semibold tabular-nums tracking-tight">{value}</p>}
        {hint && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
      </CardContent>
    </Card>
  )
}

export default function OverviewPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [clients, setClients] = useState<Client[] | null>(null)

  useEffect(() => {
    fetch('/api/leads').then(r => r.ok ? r.json() : []).then(setLeads).catch(() => setLeads([]))
    fetch('/api/website/projects').then(r => r.ok ? r.json() : []).then(setProjects).catch(() => setProjects([]))
    fetch('/api/website/clients').then(r => r.ok ? r.json() : []).then(setClients).catch(() => setClients([]))
  }, [])

  const loading = leads === null
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000
  const leadsThisWeek = (leads ?? []).filter(l => new Date(l.created_at).getTime() > weekAgo).length
  const recent = (leads ?? []).slice(0, 6)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Overview</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Live numbers from the master database.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Leads · total" value={leads?.length ?? 0} loading={loading} hint="All form submissions" icon={Inbox} />
        <Stat label="Leads · 7 days" value={leadsThisWeek} loading={loading} hint="New this week" icon={TrendingUp} />
        <Stat
          label="Website projects"
          value={projects ? `${projects.filter(p => p.published).length}/${projects.length}` : 0}
          loading={projects === null}
          hint="Published / total in CMS"
          icon={Globe}
        />
        <Stat label="Clients" value={clients?.length ?? 0} loading={clients === null} hint="In master registry" icon={Users} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader className="flex-row items-center">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Inbox className="h-4 w-4 text-zinc-400 dark:text-zinc-500" /> Latest leads
            </CardTitle>
            <Button variant="ghost" size="sm" className="ml-auto" asChild>
              <Link href="/dashboard/leads">View all <ArrowRight className="h-3.5 w-3.5" /></Link>
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 pt-0">
            {loading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
            {!loading && recent.length === 0 && (
              <p className="py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">No leads yet.</p>
            )}
            {recent.map(l => (
              <div key={l.id} className="flex items-baseline gap-3 rounded-md px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                <span className="text-sm font-medium">{l.fname} {l.lname}</span>
                <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">{l.biz}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] uppercase text-zinc-400 dark:text-zinc-500">
                  {new Date(l.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="flex-row items-center">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Globe className="h-4 w-4 text-zinc-400 dark:text-zinc-500" /> Website CMS
              </CardTitle>
              <Button variant="ghost" size="sm" className="ml-auto" asChild>
                <Link href="/dashboard/website">Manage <ArrowRight className="h-3.5 w-3.5" /></Link>
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              {projects === null ? <Skeleton className="h-9 w-full" /> : projects.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  CMS is empty — the site serves the built-in project list. Import them from the Website page.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {projects.slice(0, 8).map(p => (
                    <Badge key={p.id} variant={p.published ? 'secondary' : 'outline'} className="font-normal">
                      {p.name}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Users className="h-4 w-4 text-zinc-400 dark:text-zinc-500" /> Quick links
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 pt-0 text-sm">
              <a href="https://www.mdmmarketing.com.au" target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
                Live site <ExternalLink className="h-3 w-3" />
              </a>
              <a href="https://calendly.com/mdmmarketing-info" target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
                Calendly <ExternalLink className="h-3 w-3" />
              </a>
              <a href="https://scorecard.mdmmarketing.com.au" target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
                Diagnostic scorecard <ExternalLink className="h-3 w-3" />
              </a>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
