import { ToolLoopAgent, createAgentUIStreamResponse, stepCountIs } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../lib/authz'
import { assistantTools } from '../../lib/assistant-tools'

export const maxDuration = 120

/**
 * The dashboard assistant.
 *
 * The agent is built inside the request, not at module scope, because its
 * toolbox closes over the caller's role — and because building it at import
 * time would make missing env vars a build failure (trap 7).
 *
 * `requireRole('editor')` is the door. Beyond it, reads run freely and the
 * two write tools stream an approval request to the browser instead of
 * executing; the loop resumes only after the person clicks Approve.
 */
export async function POST(req: Request) {
  let user
  try {
    user = await requireRole('editor')
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }

  const { messages } = await req.json()

  const agent = new ToolLoopAgent({
    model: anthropic('claude-sonnet-5'),
    instructions: `You are the MD Media assistant, living inside the agency's dashboard.
MD Media is a Melbourne marketing agency. You answer questions about clients,
leads, intake forms, the content schedule, the inbox scanner, and the team, and
you can make small approved edits.

You are talking to ${user.name || user.email} (role: ${user.role}).
The agency runs on Melbourne time (AEST/AEDT); present all times in Melbourne time.
Today is ${new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Melbourne', dateStyle: 'full' })}.

Ground rules:
- Answer from tool results, never from assumption. If a tool returns nothing, say so plainly.
- Use plain language and short answers. No em dashes. No markdown tables unless listing more than five items.
- For edits, state exactly what you are about to change and let the approval flow do its job.
- You cannot delete anything, send email, or touch credentials. If asked, say it needs doing in the dashboard by hand.`,
    tools: assistantTools(user.role),
    stopWhen: stepCountIs(12),
  })

  return createAgentUIStreamResponse({ agent, uiMessages: messages })
}
