import 'server-only'
import { table } from '@/lib/db'
import type { AssistantChat, AssistantPref } from '@/lib/db-types'
import { chatTitleFrom, clampInstructions, type ChatMessage } from './assistant-core'

/**
 * Storage for assistant chats and per-user behaviour.
 *
 * Every function takes the owner's Clerk user id and resolves rows THROUGH it,
 * so knowing another person's chat id gets you nothing — the same discipline
 * as intake forms resolving through the client.
 */

export type ChatSummary = { id: string; title: string; updated_at: string }

export async function listChats(ownerId: string): Promise<ChatSummary[]> {
  const rows = await table<AssistantChat>('assistant_chats').list({
    by: { clerk_user_id: ownerId },
    orderBy: [['updated_at', 'desc']],
    limit: 50,
  })
  return rows.map(r => ({ id: r.id, title: r.title, updated_at: r.updated_at }))
}

export async function getChatMessages(ownerId: string, chatId: string): Promise<ChatMessage[] | null> {
  const row = await table<AssistantChat>('assistant_chats').get(chatId)
  if (!row || row.clerk_user_id !== ownerId) return null
  return (row.messages as ChatMessage[] | undefined) ?? null
}

/**
 * Replace the chat with its post-response state. Insert and update are one
 * upsert on the id; ownership is enforced by checking the existing row's
 * owner first, so a colliding or guessed id cannot overwrite someone else's
 * chat (it fails, rather than being silently re-owned).
 */
export async function saveChat(ownerId: string, chatId: string, messages: ChatMessage[]): Promise<void> {
  const chats = table<AssistantChat>('assistant_chats')
  const existing = await chats.get(chatId)
  if (existing && existing.clerk_user_id !== ownerId) {
    throw new Error('Not your chat')
  }
  await table('assistant_chats').upsert({
    id: chatId,
    clerk_user_id: ownerId,
    title: chatTitleFrom(messages),
    messages,
    updated_at: new Date().toISOString(),
  })
}

export async function deleteChat(ownerId: string, chatId: string): Promise<boolean> {
  const chats = table<AssistantChat>('assistant_chats')
  const existing = await chats.get(chatId)
  if (!existing || existing.clerk_user_id !== ownerId) return false
  await chats.remove(chatId)
  return true
}

export async function getInstructions(clerkUserId: string): Promise<string> {
  const rows = await table<AssistantPref>('assistant_prefs').list({
    by: { clerk_user_id: clerkUserId }, limit: 1,
  })
  return rows[0]?.instructions ?? ''
}

export async function saveInstructions(
  clerkUserId: string, email: string, instructions: unknown, updatedBy: string,
): Promise<string> {
  const clean = clampInstructions(instructions)
  await table('assistant_prefs').upsert({
    clerk_user_id: clerkUserId,
    email,
    instructions: clean,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  })
  return clean
}
