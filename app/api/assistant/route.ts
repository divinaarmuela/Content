import { ToolLoopAgent, createAgentUIStreamResponse, stepCountIs } from 'ai'
import type { UIMessage } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../lib/authz'
import { assistantTools } from '../../lib/assistant-tools'
import { composeInstructions, isChatId, trimForModel } from '../../lib/assistant-core'
import { getInstructions, saveChat } from '../../lib/assistant-chats'

export const maxDuration = 120

/**
 * The dashboard assistant.
 *
 * The agent is built inside the request, not at module scope, because its
 * toolbox closes over the caller's role — and because building it at import
 * time would make missing env vars a build failure (trap 7).
 *
 * `requireRole('editor')` is the door. Beyond it, reads run freely and the
 * write tools stream an approval request to the browser instead of executing;
 * the loop resumes only after the person clicks Approve.
 *
 * History: the browser mints the chat id and sends the full UIMessage list;
 * when the response completes, `onFinish` stores the post-response state
 * under that id for the signed-in owner. The model sees a bounded tail of a
 * long chat; the stored history keeps everything.
 */
export async function POST(req: Request) {
  let user
  try {
    user = await requireRole('editor')
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }

  const body = await req.json()
  const messages = (body?.messages ?? []) as UIMessage[]
  const chatId: string | null = isChatId(body?.id) ? body.id : null
  const ownerId = user.clerk_user_id ?? user.email

  const personal = await getInstructions(ownerId).catch(() => '')

  const base = `You are the MD Media assistant, living inside the agency's dashboard.
MD Media is a Melbourne marketing agency. You answer questions about clients,
leads, intake forms, the content schedule, the inbox scanner, and the team, and
you can make small approved edits.

You are talking to ${user.name || user.email} (role: ${user.role}).
Present all times in their timezone, ${user.timezone}. It is now ${new Date().toLocaleString('en-AU', { timeZone: user.timezone || 'Australia/Melbourne', dateStyle: 'full', timeStyle: 'short' })} for them.
The agency itself operates on Melbourne time.

Ground rules:
- Answer from tool results, never from assumption. If a tool returns nothing, say so plainly.
- Use plain language and short answers. No em dashes. No markdown tables unless listing more than five items.
- For edits, state exactly what you are about to change and let the approval flow do its job.
- You cannot delete anything, send email, or touch credentials. If asked, say it needs doing in the dashboard by hand.`

  const agent = new ToolLoopAgent({
    model: anthropic('claude-sonnet-5'),
    instructions: composeInstructions(base, personal),
    tools: assistantTools(user.role),
    stopWhen: stepCountIs(12),
  })

  return createAgentUIStreamResponse({
    agent,
    uiMessages: trimForModel(messages),
    // wire messages can't be statically proven to match this agent's tool
    // types; runtime shape is the SDK's own serialisation of them
    originalMessages: messages as never,
    onFinish: chatId
      ? async ({ messages: all }) => {
          try {
            await saveChat(ownerId, chatId, all)
          } catch (e) {
            // history must never fail the answer the person is reading
            console.error('assistant chat save failed:', e)
          }
        }
      : undefined,
  })
}
