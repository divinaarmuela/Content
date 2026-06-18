'use client'

import { ClerkProvider } from '@clerk/nextjs'

// Scope Clerk to this auth-callback route so the public marketing pages don't
// load the Clerk SDK (it's intentionally not in the root layout).
export default function SSOCallbackLayout({ children }: { children: React.ReactNode }) {
  return <ClerkProvider>{children}</ClerkProvider>
}
