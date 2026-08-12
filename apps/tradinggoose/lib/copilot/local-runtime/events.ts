import type { LocalCopilotToolCall } from '@/lib/copilot/local-runtime/types'

/**
 * Builders for the SSE events the hosted Copilot service emits. The chat route,
 * the mark-complete route and the browser store all parse this exact shape, so
 * the local runtime has to reproduce it byte for byte rather than invent its own.
 *
 * The `response.*` events follow the OpenAI Responses streaming vocabulary; the
 * rest (`start`, `awaiting_tools`, `error`) are the hosted service's own.
 */
export type CopilotSseEvent = Record<string, unknown>

export function startEvent(conversationId: string): CopilotSseEvent {
  return { type: 'start', data: { conversationId } }
}

export function assistantItemAdded(itemId: string): CopilotSseEvent {
  return {
    type: 'response.output_item.added',
    item: {
      id: itemId,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: '' }],
    },
  }
}

export function assistantTextDelta(itemId: string, delta: string): CopilotSseEvent {
  return { type: 'response.output_text.delta', item_id: itemId, delta }
}

export function assistantItemDone(itemId: string, text: string): CopilotSseEvent {
  return {
    type: 'response.output_item.done',
    item: {
      id: itemId,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text }],
    },
  }
}

export function reasoningItemAdded(itemId: string): CopilotSseEvent {
  return {
    type: 'response.output_item.added',
    item: {
      id: itemId,
      type: 'reasoning',
      content: [{ type: 'reasoning_text', text: '' }],
    },
  }
}

export function reasoningTextDelta(itemId: string, delta: string): CopilotSseEvent {
  return { type: 'response.reasoning_text.delta', item_id: itemId, delta }
}

export function reasoningItemDone(itemId: string, text: string): CopilotSseEvent {
  return {
    type: 'response.output_item.done',
    item: {
      id: itemId,
      type: 'reasoning',
      content: [{ type: 'reasoning_text', text }],
    },
  }
}

/**
 * The browser keys tool calls by `call_id`, not `id`, and rejects the item when
 * either that or `name` is missing.
 */
export function functionCallItemDone(toolCall: LocalCopilotToolCall): CopilotSseEvent {
  return {
    type: 'response.output_item.done',
    item: {
      id: toolCall.id,
      type: 'function_call',
      call_id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments,
    },
  }
}

export function awaitingToolsEvent(toolCalls: LocalCopilotToolCall[]): CopilotSseEvent {
  return {
    type: 'awaiting_tools',
    data: { pendingToolCallIds: toolCalls.map((toolCall) => toolCall.id) },
  }
}

export function responseCompletedEvent(responseId: string): CopilotSseEvent {
  return { type: 'response.completed', response: { id: responseId } }
}

export function errorEvent(message: string): CopilotSseEvent {
  return { type: 'error', error: message, data: { displayMessage: message } }
}
