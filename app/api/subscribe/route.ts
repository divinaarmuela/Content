import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { sendSystemEmail } from '../../lib/mailer'

/**
 * PUBLIC — newsletter signup from the journal page.
 *
 * Same shape as /api/submit: the database is the source of truth, persist
 * first; the team notification is best-effort and can never lose a signup.
 * Deliberately outside the middleware matcher, so it stays Clerk-free.
 */

export async function POST(req: NextRequest) {
  let body: { email?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const email = String(body.email ?? '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
  }

  // upsert so subscribing twice is a quiet success, not an error the visitor
  // has to puzzle over
  const { error } = await supabase
    .from('newsletter_subscribers')
    .upsert({ email, source: 'journal' }, { onConflict: 'email', ignoreDuplicates: true })
  if (error) {
    console.error('subscribe insert error:', error)
    return NextResponse.json(
      { error: 'Something went wrong — please try again in a moment.' },
      { status: 502 },
    )
  }

  // best-effort heads-up so signups are visible without a dashboard page
  try {
    await sendSystemEmail({
      to: process.env.GMAIL_USER ?? 'hello@mdmmarketing.com.au',
      subject: `New field notes subscriber — ${email}`,
      html: `<p><strong>${email}</strong> subscribed to field notes via the journal page.</p>`,
    })
  } catch (err) {
    console.error('subscribe notification error:', err)
  }

  return NextResponse.json({ success: true })
}
