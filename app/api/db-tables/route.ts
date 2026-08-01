import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { guard } from '@/app/lib/authz'

export async function GET() {
  const denied = await guard('super_admin')
  if (denied) return denied

  const { data, error } = await supabase
    .from('information_schema.tables')
    .select('table_name, table_schema')
    .eq('table_schema', 'public')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
