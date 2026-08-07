'use client'

import Link from 'next/link'

import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Trash2 } from 'lucide-react'
import ScannerSettings from './ScannerSettings'
import IntakeTemplates from './IntakeTemplates'
import ProfileSettings from './ProfileSettings'
import IntegrationsSettings from './IntegrationsSettings'
import CredentialsPanel from '../CredentialsPanel'
import { useRole } from '../useRole'

export default function SettingsPage() {
  // Scanner settings and team management are super_admin work — their APIs
  // already reject anyone else, so offering the tabs only produced controls
  // that error on use.
  const { can, loading } = useRole()
  const isSuper = can('super_admin')

  // The tab list depends on the role, which arrives a moment after mount.
  // Rendering the reduced set first made the bar visibly change shape as the
  // super-admin tabs appeared — hold the shape until we know.
  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-9 w-96" />
        <Skeleton className="h-80 w-full" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Workspace configuration, team, and integrations.
          </p>
        </div>
      </div>

      <Tabs defaultValue="profile" className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          {isSuper && <TabsTrigger value="team">Team</TabsTrigger>}
          {isSuper && <TabsTrigger value="scanner">Inbox scanner</TabsTrigger>}
          {isSuper && <TabsTrigger value="intake">Intake templates</TabsTrigger>}
          <TabsTrigger value="credentials">Credentials</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        {isSuper && (
          <TabsContent value="scanner">
            <ScannerSettings />
          </TabsContent>
        )}

        {isSuper && (
          <TabsContent value="intake">
            <IntakeTemplates />
          </TabsContent>
        )}

        {/* MD Media's own logins — the agency has accounts of its own, and
            hanging them off a placeholder client would bury them in that
            client's panel. Same encryption and the same view/change split as
            client credentials. */}
        <TabsContent value="credentials">
          <Card className="border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <CardHeader>
              <CardTitle className="text-base">MD Media credentials</CardTitle>
              <CardDescription>
                Our own platform logins. Client logins live on each client&rsquo;s page.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CredentialsPanel endpoint="/api/team/credentials" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="profile">
          <ProfileSettings />
        </TabsContent>

        {/* Team management is a real page. Duplicating a half version here
            meant two places to look and one of them was fiction. */}
        <TabsContent value="team">
          <Card className="border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <CardHeader>
              <CardTitle className="text-base">Team</CardTitle>
              <CardDescription>
                People, roles, invites and access live on the Team page.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" asChild>
                <Link href="/dashboard/team">Open Team</Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations">
          <IntegrationsSettings />
        </TabsContent>

      </Tabs>
    </div>
  )
}
