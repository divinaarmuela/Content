'use client'

import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import CredentialsPanel from '../../CredentialsPanel'

/** MD Media's own logins — the agency has accounts of its own, and hanging
 *  them off a placeholder client would bury them in that client's panel. */
export default function TeamCredentialsPage() {
  return (
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
  )
}
