import type { LocalCopilotConversation } from '@/lib/copilot/local-runtime/types'
import { deleteCachedValue, getCachedValue, setCachedValue } from '@/lib/redis'

/**
 * Conversation state lives in Redis so a turn can be resumed by whichever
 * instance receives the `/api/tools/mark-complete` follow-up. With no REDIS_URL
 * configured `lib/redis` falls back to an in-process map, which is correct for a
 * single-container deployment and degrades to "the turn cannot resume" rather
 * than to wrong answers if the app is ever scaled out without Redis.
 */
const CONVERSATION_PREFIX = 'copilot:local:conversation:'
const TOOL_CALL_PREFIX = 'copilot:local:toolcall:'

/** Long enough for a user to walk away mid-turn, short enough to not leak. */
const CONVERSATION_TTL_SECONDS = 60 * 60 * 24

/**
 * Caps stored history so a long-running chat cannot grow the cached blob without
 * bound. The oldest turns fall out; the model still sees recent context.
 */
const MAX_STORED_MESSAGES = 200

function conversationKey(conversationId: string) {
  return `${CONVERSATION_PREFIX}${conversationId}`
}

function toolCallKey(toolCallId: string) {
  return `${TOOL_CALL_PREFIX}${toolCallId}`
}

export async function loadConversation(
  conversationId: string
): Promise<LocalCopilotConversation | null> {
  const raw = await getCachedValue(conversationKey(conversationId))
  if (!raw) return null

  try {
    return JSON.parse(raw) as LocalCopilotConversation
  } catch {
    return null
  }
}

export async function saveConversation(conversation: LocalCopilotConversation): Promise<void> {
  const trimmed: LocalCopilotConversation = {
    ...conversation,
    messages: conversation.messages.slice(-MAX_STORED_MESSAGES),
    updatedAt: Date.now(),
  }

  await setCachedValue(
    conversationKey(trimmed.id),
    JSON.stringify(trimmed),
    CONVERSATION_TTL_SECONDS
  )
}

/**
 * The resume request identifies a turn only by tool call id, so each pending call
 * needs its own pointer back to the conversation that issued it.
 */
export async function indexPendingToolCalls(
  conversationId: string,
  toolCallIds: string[]
): Promise<void> {
  await Promise.all(
    toolCallIds.map((toolCallId) =>
      setCachedValue(toolCallKey(toolCallId), conversationId, CONVERSATION_TTL_SECONDS)
    )
  )
}

export async function findConversationIdForToolCall(toolCallId: string): Promise<string | null> {
  return await getCachedValue(toolCallKey(toolCallId))
}

export async function forgetToolCall(toolCallId: string): Promise<void> {
  await deleteCachedValue(toolCallKey(toolCallId))
}
