import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { sendSystemEmail } from '../../lib/mailer'
import { autoIngestLead } from '../../lib/lead-enrichment'
import { inngest } from '../../inngest/client'
import { leadsChannel } from '../../inngest/channels'

export async function POST(req: NextRequest) {
  let body: Record<string, string>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { fname, lname, email, phone, biz, model, need, budget, timeline } = body

  if (!fname || !lname || !email || !phone || !biz) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }

  const row = (label: string, value?: string) =>
    value
      ? `<tr style="border-bottom:1px solid #C9C4BA;">
           <td style="padding:12px 0;color:#5A5A55;font-family:monospace;font-size:11px;letter-spacing:0.1em;width:160px;">${label}</td>
           <td style="padding:12px 0;">${value}</td>
         </tr>`
      : ''

  const teamHtml = `
    <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#F4F0E6;color:#0A0A0A;">
      <div style="background:#0A0A0A;padding:20px 32px;border-bottom:3px solid #0057FF;">
        <p style="font-family:monospace;font-size:11px;letter-spacing:0.15em;color:#8A8A85;margin:0;">// NEW LEAD &middot; MD MEDIA MARKETING</p>
      </div>
      <div style="padding:32px;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          ${row('NAME',     `${fname} ${lname}`)}
          ${row('EMAIL',    `<a href="mailto:${email}" style="color:#0057FF;">${email}</a>`)}
          ${row('PHONE',    phone)}
          ${row('BUSINESS', biz)}
          ${row('SERVICE',  model)}
          ${row('NEEDS',    need)}
          ${row('BUDGET',   budget)}
          ${row('TIMING',   timeline)}
        </table>
      </div>
      <div style="background:#0A0A0A;padding:16px 32px;">
        <p style="font-family:monospace;font-size:10px;letter-spacing:0.15em;color:#5A5A55;margin:0;">// STATUS: QUEUED FOR REVIEW &middot; mdmmarketing.com.au</p>
      </div>
    </div>
  `

  const contactHtml = `
    <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#F4F0E6;color:#0A0A0A;">
      <div style="background:#0A0A0A;padding:28px 32px;border-bottom:3px solid #0057FF;">
        <img src="https://www.mdmmarketing.com.au/MDLogo-trim.png" alt="MD Media Marketing" width="169" height="28" style="height:28px;width:169px;display:block;border:0;" />
      </div>
      <div style="padding:40px 32px;">
        <p style="font-family:monospace;font-size:11px;letter-spacing:0.15em;color:#8A8A85;margin:0 0 24px;">// BRIEF RECEIVED</p>
        <h1 style="font-size:32px;font-weight:500;letter-spacing:-0.025em;line-height:1.1;margin:0 0 20px;">
          Thanks ${fname}.<br/>Brief <span style="color:#0057FF;">received.</span>
        </h1>
        <p style="font-size:16px;line-height:1.7;color:#5A5A55;margin:0 0 32px;">
          We've got your enquiry and someone from the team will be in touch shortly.
        </p>
        <p style="font-size:16px;line-height:1.7;color:#5A5A55;margin:0 0 32px;">
          Want to lock in a time now? Grab a spot below and we'll come prepared.
        </p>
        <a href="https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone"
          style="display:inline-block;background:#0057FF;color:#F4F0E6;font-family:monospace;font-size:12px;font-weight:600;letter-spacing:0.15em;text-decoration:none;padding:16px 28px;margin-bottom:40px;">
          Book a 10-min call →
        </a>
        <div style="border-top:1px solid #C9C4BA;padding-top:24px;">
          <p style="font-family:monospace;font-size:11px;color:#8A8A85;letter-spacing:0.08em;margin:0;">
            MD Media Marketing &middot; Melbourne, AU &middot;
            <a href="mailto:hello@mdmmarketing.com.au" style="color:#0057FF;text-decoration:none;">hello@mdmmarketing.com.au</a>
          </p>
        </div>
      </div>
    </div>
  `

  // The database is the source of truth for leads — persist FIRST, so an email
  // outage can never lose an enquiry. Email is the notification layer.
  const { data: savedLead, error: dbError } = await supabase.from('leads').insert({
    fname, lname, email, phone, biz,
    model: model ?? null,
    need:  need ?? null,
    budget: budget ?? null,
    timeline: timeline ?? null,
  }).select().single()
  if (dbError) console.error('Supabase insert error:', dbError)

  // Auto-ingest: verified companies become prospect clients automatically.
  // Fire-and-forget — never delays or fails the visitor's submission.
  if (savedLead) {
    void autoIngestLead(savedLead).catch(e => console.error('auto-ingest error:', e))

    // A form lead is the one kind that is genuinely instant — it exists the
    // moment they press submit, with no scanner cron in between. Announce it.
    // Publishing outside a function is not retry-safe, so the receiver treats
    // messages as hints and refetches rather than trusting them.
    void inngest.realtime.publish(leadsChannel.created, {
      id: savedLead.id as string,
      label: biz || `${fname} ${lname}`.trim() || email,
      source: 'web_form',
      ts: Date.now(),
    }).catch(e => console.error('realtime publish failed:', e))
  }

  let emailOk = true
  try {
    await sendSystemEmail({
      to: process.env.GMAIL_USER ?? 'hello@mdmmarketing.com.au',
      cc: 'contact@mdmmarketing.com.au',
      subject: `New Lead — ${fname} ${lname} · ${biz}`,
      html: teamHtml,
      replyTo: email,
    })
  } catch (err) {
    emailOk = false
    console.error('Team email error:', err)
  }

  // Only fail the visitor if the lead was captured NOWHERE.
  if (dbError && !emailOk) {
    return NextResponse.json(
      { error: "Sorry — we couldn't submit your brief right now. Please try again in a moment." },
      { status: 502 },
    )
  }

  // Confirmation to the contact — best-effort. The lead is already captured above,
  // so a failed auto-reply must NOT fail the submission.
  try {
    await sendSystemEmail({
      to: email,
      subject: `We've received your brief, ${fname}`,
      html: contactHtml,
    })
  } catch (err) {
    console.error('Confirmation email error:', err)
  }

  return NextResponse.json({ success: true })
}
