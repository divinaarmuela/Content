import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    type: 'OAuth2',
    user: process.env.GMAIL_USER,
    clientId: process.env.GMAIL_CLIENT_ID,
    clientSecret: process.env.GMAIL_CLIENT_SECRET,
    refreshToken: process.env.GMAIL_REFRESH_TOKEN,
  },
  tls: {
    rejectUnauthorized: false,
  },
})

export async function POST(req: NextRequest) {
  let body: Record<string, string>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { fname, lname, email, phone, biz, industry, model, need, budget, timeline } = body

  if (!fname || !lname || !email || !phone || !biz) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }

  // Save to Supabase
  const { error: dbError } = await supabase.from('content_applications').insert({
    first_name: fname,
    last_name: lname,
    email,
    phone,
    business: biz,
    industry: industry || null,
    model_interest: model || null,
    content_needed: need || null,
    budget: budget || null,
    timeline: timeline || null,
  })

  if (dbError) {
    console.error('Supabase insert error:', dbError.message)
    return NextResponse.json({ error: 'Failed to save submission' }, { status: 500 })
  }

  // Send email notification (non-critical — log failure but don't block response)
  try {
    await transporter.sendMail({
      from: `"MD Media" <${process.env.GMAIL_USER}>`,
      to: process.env.GMAIL_USER,
      cc: 'contact@mdmmarketing.com.au, akmalashwin23@gmail.com',
      subject: `New Content Brief — ${fname} ${lname} / ${biz}`,
      html: `
        <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#F4F0E6;color:#0A0A0A;">
          <div style="background:#0A0A0A;padding:20px 32px;border-bottom:3px solid #0057FF;">
            <p style="font-family:monospace;font-size:11px;letter-spacing:0.15em;color:#8A8A85;margin:0;">
              // NEW_BRIEF &middot; CONTENT APPLICATION
            </p>
          </div>
          <div style="padding:32px;">
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <tr style="border-bottom:1px solid #C9C4BA;">
                <td style="padding:12px 0;color:#5A5A55;font-family:monospace;font-size:11px;letter-spacing:0.1em;width:160px;">NAME</td>
                <td style="padding:12px 0;font-weight:500;">${fname} ${lname}</td>
              </tr>
              <tr style="border-bottom:1px solid #C9C4BA;">
                <td style="padding:12px 0;color:#5A5A55;font-family:monospace;font-size:11px;letter-spacing:0.1em;">EMAIL</td>
                <td style="padding:12px 0;"><a href="mailto:${email}" style="color:#0057FF;">${email}</a></td>
              </tr>
              <tr style="border-bottom:1px solid #C9C4BA;">
                <td style="padding:12px 0;color:#5A5A55;font-family:monospace;font-size:11px;letter-spacing:0.1em;">PHONE</td>
                <td style="padding:12px 0;">${phone}</td>
              </tr>
              <tr style="border-bottom:1px solid #C9C4BA;">
                <td style="padding:12px 0;color:#5A5A55;font-family:monospace;font-size:11px;letter-spacing:0.1em;">BUSINESS</td>
                <td style="padding:12px 0;font-weight:500;">${biz}</td>
              </tr>
              ${industry ? `<tr style="border-bottom:1px solid #C9C4BA;"><td style="padding:12px 0;color:#5A5A55;font-family:monospace;font-size:11px;letter-spacing:0.1em;">INDUSTRY</td><td style="padding:12px 0;">${industry}</td></tr>` : ''}
              ${model ? `<tr style="border-bottom:1px solid #C9C4BA;"><td style="padding:12px 0;color:#5A5A55;font-family:monospace;font-size:11px;letter-spacing:0.1em;">MODEL</td><td style="padding:12px 0;">${model}</td></tr>` : ''}
              ${need ? `<tr style="border-bottom:1px solid #C9C4BA;"><td style="padding:12px 0;color:#5A5A55;font-family:monospace;font-size:11px;letter-spacing:0.1em;">NEEDS</td><td style="padding:12px 0;">${need}</td></tr>` : ''}
              ${budget ? `<tr style="border-bottom:1px solid #C9C4BA;"><td style="padding:12px 0;color:#5A5A55;font-family:monospace;font-size:11px;letter-spacing:0.1em;">BUDGET</td><td style="padding:12px 0;">${budget}</td></tr>` : ''}
              ${timeline ? `<tr><td style="padding:12px 0;color:#5A5A55;font-family:monospace;font-size:11px;letter-spacing:0.1em;">TIMELINE</td><td style="padding:12px 0;">${timeline}</td></tr>` : ''}
            </table>
          </div>
          <div style="background:#0A0A0A;padding:16px 32px;">
            <p style="font-family:monospace;font-size:10px;letter-spacing:0.15em;color:#5A5A55;margin:0;">
              // STATUS: QUEUED_FOR_REVIEW &middot; Respond within 48h &middot; content.mdmmarketing.com.au
            </p>
          </div>
        </div>
      `,
    })
  } catch (mailError) {
    console.error('Nodemailer error:', mailError)
  }

  return NextResponse.json({ success: true })
}
