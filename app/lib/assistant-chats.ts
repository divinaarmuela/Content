import 'server-only'
import { supabase } from '@/lib/supabase'
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
  const { data, error } = await supabase
    .from('assistant_chats')
    .select('id, title, updated_at')
    .eq('clerk_user_id', ownerId)
    .order('updated_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getChatMessages(ownerId: string, chatId: string): Promise<ChatMessage[] | null> {
  const { data } = await supabase
    .from('assistant_chats')
    .select('messages')
    .eq('clerk_user_id', ownerId)
    .eq('id', chatId)
    .maybeSingle()
  return (data?.messages as ChatMessage[] | undefined) ?? null
}

/**
 * Replace the chat with its post-response state. Insert and update are one
 * upsert on the primary key; ownership is enforced by checking the existing
 * row's owner first, so a colliding or guessed id cannot overwrite someone
 * else's chat (it fails, rather than being silently re-owned).
 */
export async function saveChat(ownerId: string, chatId: string, messages: ChatMessage[]): Promise<void> {
  const { data: existing } = await supabase
    .from('assistant_chats').select('clerk_user_id').eq('id', chatId).maybeSingle()
  if (existing && existing.clerk_user_id !== ownerId) {
    throw new Error('Not your chat')
  }
  const { error } = await supabase.from('assistant_chats').upsert({
    id: chatId,
    clerk_user_id: ownerId,
    title: chatTitleFrom(messages),
    messages,
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
}

export async function deleteChat(ownerId: string, chatId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('assistant_chats')
    .delete()
    .eq('clerk_user_id', ownerId)
    .eq('id', chatId)
    .select('id')
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}

export async function getInstructions(clerkUserId: string): Promise<string> {
  const { data } = await supabase
    .from('assistant_prefs')
    .select('instructions')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle()
  return data?.instructions ?? ''
}

export async function saveInstructions(
  clerkUserId: string, email: string, instructions: unknown, updatedBy: string,
): Promise<string> {
  const clean = clampInstructions(instructions)
  const { error } = await supabase.from('assistant_prefs').upsert({
    clerk_user_id: clerkUserId,
    email,
    instructions: clean,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  })
  if (error) throw new Error(error.message)
  return clean
}
