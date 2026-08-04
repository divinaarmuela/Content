'use client'

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
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Trash2 } from 'lucide-react'
import ScannerSettings from './ScannerSettings'
import { useRole } from '../useRole'

const TEAM = [
  { name: 'Marcus Doyle', email: 'marcus@mdmmarketing.com.au', role: 'Owner', initials: 'MD' },
  { name: 'Sasha Nguyen', email: 'sasha@mdmmarketing.com.au', role: 'Admin', initials: 'SN' },
  { name: 'Priya Sharma', email: 'priya@mdmmarketing.com.au', role: 'Editor', initials: 'PS' },
]

const INTEGRATIONS = [
  {
    name: 'Instagram',
    description: 'Publish and pull performance data from client accounts.',
    connected: true,
  },
  {
    name: 'Google Drive',
    description: 'Sync shoot assets and client deliverables.',
    connected: true,
  },
  {
    name: 'Slack',
    description: 'Approval and shoot reminders in your team channels.',
    connected: false,
  },
  {
    name: 'Stripe',
    description: 'Client billing and invoice status.',
    connected: false,
  },
]

function saveDemo() {
  toast.success('Saved (demo)')
}

export default function SettingsPage() {
  // Scanner settings, team management and the danger zone are super_admin
  // work — their APIs already reject anyone else, so offering the tabs only
  // produced controls that error on use.
  const { can } = useRole()
  const isSuper = can('super_admin')

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
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          {isSuper && <TabsTrigger value="danger">Danger zone</TabsTrigger>}
        </TabsList>

        {isSuper && (
          <TabsContent value="scanner">
            <ScannerSettings />
          </TabsContent>
        )}

        <TabsContent value="profile">
          <Card className="border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <CardHeader>
              <CardTitle className="text-base">Profile</CardTitle>
              <CardDescription>
                Your personal details and workspace preferences.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="profile-name">Full name</Label>
                  <Input id="profile-name" defaultValue="Marcus Doyle" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="profile-email">Email</Label>
                  <Input
                    id="profile-email"
                    type="email"
                    defaultValue="marcus@mdmmarketing.com.au"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="profile-workspace">Workspace name</Label>
                  <Input id="profile-workspace" defaultValue="MD Media" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="profile-timezone">Timezone</Label>
                  <Select defaultValue="sydney">
                    <SelectTrigger id="profile-timezone">
                      <SelectValue placeholder="Select timezone" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sydney">Australia/Sydney</SelectItem>
                      <SelectItem value="melbourne">Australia/Melbourne</SelectItem>
                      <SelectItem value="brisbane">Australia/Brisbane</SelectItem>
                      <SelectItem value="perth">Australia/Perth</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Separator className="bg-zinc-200 dark:bg-zinc-800" />
              <div className="flex flex-col gap-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
                  Email notifications
                </span>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      Approval updates
                    </p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      When a client approves or requests changes.
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      Weekly digest
                    </p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      A Monday summary of performance across clients.
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      Product updates
                    </p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      Occasional news about new features.
                    </p>
                  </div>
                  <Switch />
                </div>
              </div>
            </CardContent>
            <CardFooter className="justify-end border-t border-zinc-200 dark:border-zinc-800">
              <Button onClick={saveDemo}>Save changes</Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="team">
          <Card className="border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <CardHeader>
              <CardTitle className="text-base">Team</CardTitle>
              <CardDescription>
                People with access to this workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex flex-1 flex-col gap-2">
                  <Label htmlFor="invite-email">Invite by email</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="name@company.com"
                  />
                </div>
                <Button variant="outline" onClick={saveDemo}>
                  Send invite
                </Button>
              </div>
              <Separator className="bg-zinc-200 dark:bg-zinc-800" />
              <div className="flex flex-col">
                {TEAM.map((member, index) => (
                  <div key={member.email}>
                    {index > 0 && <Separator className="bg-zinc-200 dark:bg-zinc-800" />}
                    <div className="flex items-center gap-3 py-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="bg-zinc-100 dark:bg-zinc-800 text-xs text-zinc-500 dark:text-zinc-400">
                          {member.initials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {member.name}
                        </p>
                        <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
                          {member.email}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
                      >
                        {member.role}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations">
          <Card className="border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <CardHeader>
              <CardTitle className="text-base">Integrations</CardTitle>
              <CardDescription>
                Connect the tools your agency already uses.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col">
              {INTEGRATIONS.map((integration, index) => (
                <div key={integration.name}>
                  {index > 0 && <Separator className="bg-zinc-200 dark:bg-zinc-800" />}
                  <div className="flex items-center gap-4 py-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {integration.name}
                        </p>
                        {integration.connected ? (
                          <Badge className="border-transparent bg-emerald-50 dark:bg-emerald-950/40 font-mono text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                            Connected
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500"
                          >
                            Not connected
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                        {integration.description}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={saveDemo}>
                      {integration.connected ? 'Manage' : 'Connect'}
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="danger">
          <Card className="border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/30">
            <CardHeader>
              <CardTitle className="text-base text-red-700 dark:text-red-400">
                Danger zone
              </CardTitle>
              <CardDescription>
                Irreversible actions for this workspace.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-4 rounded-lg border border-red-200 dark:border-red-900 bg-white dark:bg-zinc-900 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    Delete workspace
                  </p>
                  <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                    Permanently remove MD Media and all client data. This
                    cannot be undone.
                  </p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive">
                      <Trash2 className="h-4 w-4" />
                      Delete workspace
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Delete this workspace?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete MD Media, including all
                        clients, content, and reports. This action cannot be
                        undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() =>
                          toast.error('Workspace deletion is disabled (demo)')
                        }
                      >
                        Delete workspace
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
