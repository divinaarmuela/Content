import { NextResponse } from 'next/server'
import { listTables, withRequestCache } from '@/lib/db'
import { guard } from '@/app/lib/authz'

export async function GET() {
  return withRequestCache(async () => {
    const denied = await guard('super_admin')
    if (denied) return denied

    return NextResponse.json({ tables: await listTables() })
  })
}
