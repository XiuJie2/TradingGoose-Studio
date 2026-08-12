import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import {
  resolveLocalCopilotBaseUrl,
  stripProviderPrefix,
} from '@/lib/copilot/local-runtime/providers'
import type { LlmStreamDelta, LocalCopilotMessage } from '@/lib/copilot/local-runtime/types'
import type { CopilotRuntimeToolManifestTool } from '@/lib/copilot/runtime-tool-manifest'
import { getMaxOutputTokensForModel } from '@/providers/ai/models'
import type { ProviderId } from '@/providers/ai/types'

export interface LlmStreamParams {
  provider: ProviderId
  model: string
  apiKey: string
  systemPrompt: string
  messages: LocalCopilotMessage[]
  tools: CopilotRuntimeToolManifestTool[]
  signal?: AbortSignal
}

/**
 * Streams one model turn and yields normalized deltas. Tool calls are surfaced,
 * never executed here: the browser owns execution for every Copilot tool, so the
 * caller pauses the turn and resumes it when results come back.
 */
export function streamLlm(params: LlmStreamParams): AsyncGenerator<LlmStreamDelta> {
  return params.provider === 'anthropic' ? streamAnthropic(params) : streamOpenAiCompatible(params)
}

/* -------------------------------------------------------------------------- */
/* OpenAI-compatible                                                          */
/* -------------------------------------------------------------------------- */

function toOpenAiMessages(
  systemPrompt: string,
  messages: LocalCopilotMessage[]
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const converted: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ]

  for (const message of messages) {
    if (message.role === 'user') {
      converted.push({ role: 'user', content: message.content })
      continue
    }

    if (message.role === 'tool') {
      converted.push({
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: message.content,
      })
      continue
    }

    const toolCalls = message.toolCalls ?? []
    converted.push({
      role: 'assistant',
      // The API rejects an assistant turn with neither content nor tool calls.
      content: message.content || (toolCalls.length > 0 ? null : ''),
      ...(toolCalls.length > 0
        ? {
            tool_calls: toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: 'function' as const,
              function: { name: toolCall.name, arguments: toolCall.arguments || '{}' },
            })),
          }
        : {}),
    })
  }

  return converted
}

function toOpenAiTools(
  tools: CopilotRuntimeToolManifestTool[]
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: (tool.parameters ?? { type: 'object', properties: {} }) as Record<
        string,
        unknown
      >,
    },
  }))
}

async function* streamOpenAiCompatible(params: LlmStreamParams): AsyncGenerator<LlmStreamDelta> {
  const baseURL = await resolveLocalCopilotBaseUrl(params.provider)
  const client = new OpenAI({ apiKey: params.apiKey, ...(baseURL ? { baseURL } : {}) })

  const stream = await client.chat.completions.create(
    {
      model: stripProviderPrefix(params.provider, params.model),
      messages: toOpenAiMessages(params.systemPrompt, params.messages),
      stream: true,
      ...(params.tools.length > 0 ? { tools: toOpenAiTools(params.tools) } : {}),
    },
    { signal: params.signal }
  )

  // Streamed tool calls arrive as fragments addressed by array index, and only
  // the first fragment carries the id and name.
  const seenToolCallIndexes = new Set<number>()

  for await (const chunk of stream) {
    const choice = chunk.choices?.[0]
    const delta = choice?.delta as
      | (OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta & {
          reasoning_content?: string
          reasoning?: string
        })
      | undefined

    if (chunk.usage) {
      yield {
        type: 'usage',
        inputTokens: chunk.usage.prompt_tokens ?? 0,
        outputTokens: chunk.usage.completion_tokens ?? 0,
      }
    }

    if (!delta) continue

    // DeepSeek and NVIDIA use `reasoning_content`; OpenRouter uses `reasoning`.
    const reasoning = delta.reasoning_content || delta.reasoning
    if (reasoning) {
      yield { type: 'reasoning', delta: reasoning }
    }

    if (typeof delta.content === 'string' && delta.content) {
      yield { type: 'text', delta: delta.content }
    }

    for (const toolCall of delta.tool_calls ?? []) {
      const index = toolCall.index ?? 0

      if (!seenToolCallIndexes.has(index)) {
        const id = toolCall.id
        const name = toolCall.function?.name
        // Some gateways repeat the index before sending an id; wait for a usable
        // pair rather than emitting a call the browser would reject.
        if (id && name) {
          seenToolCallIndexes.add(index)
          yield { type: 'tool_call_start', index, id, name }
        }
      }

      const argumentsDelta = toolCall.function?.arguments
      if (argumentsDelta) {
        yield { type: 'tool_call_arguments', index, delta: argumentsDelta }
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Anthropic                                                                  */
/* -------------------------------------------------------------------------- */

function toAnthropicMessages(messages: LocalCopilotMessage[]): Anthropic.MessageParam[] {
  const converted: Anthropic.MessageParam[] = []

  for (const message of messages) {
    if (message.role === 'user') {
      converted.push({ role: 'user', content: [{ type: 'text', text: message.content }] })
      continue
    }

    if (message.role === 'tool') {
      const toolResult: Anthropic.ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: message.toolCallId,
        content: message.content,
      }

      // Anthropic carries tool results on a user turn and rejects two user turns
      // in a row, so parallel tool calls have to collapse into one message.
      const previous = converted.at(-1)
      if (previous?.role === 'user' && Array.isArray(previous.content)) {
        previous.content.push(toolResult)
      } else {
        converted.push({ role: 'user', content: [toolResult] })
      }
      continue
    }

    const content: Anthropic.ContentBlockParam[] = []
    if (message.content) {
      content.push({ type: 'text', text: message.content })
    }
    for (const toolCall of message.toolCalls ?? []) {
      content.push({
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.name,
        input: safeParseJson(toolCall.arguments),
      })
    }
    if (content.length > 0) {
      converted.push({ role: 'assistant', content })
    }
  }

  return converted
}

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function toAnthropicTools(tools: CopilotRuntimeToolManifestTool[]): Anthropic.Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: (tool.parameters ?? {
      type: 'object',
      properties: {},
    }) as Anthropic.Tool.InputSchema,
  }))
}

async function* streamAnthropic(params: LlmStreamParams): AsyncGenerator<LlmStreamDelta> {
  const client = new Anthropic({ apiKey: params.apiKey })

  const stream = client.messages.stream(
    {
      model: stripProviderPrefix('anthropic', params.model),
      max_tokens: getMaxOutputTokensForModel(params.model),
      system: params.systemPrompt,
      messages: toAnthropicMessages(params.messages),
      ...(params.tools.length > 0 ? { tools: toAnthropicTools(params.tools) } : {}),
    },
    { signal: params.signal }
  )

  // Anthropic addresses content blocks by index the same way OpenAI addresses
  // tool call fragments, so tool_use blocks map onto the same delta vocabulary.
  for await (const event of stream) {
    if (event.type === 'content_block_start') {
      if (event.content_block.type === 'tool_use') {
        yield {
          type: 'tool_call_start',
          index: event.index,
          id: event.content_block.id,
          name: event.content_block.name,
        }
      }
      continue
    }

    if (event.type === 'content_block_delta') {
      if (event.delta.type === 'text_delta') {
        yield { type: 'text', delta: event.delta.text }
      } else if (event.delta.type === 'thinking_delta') {
        yield { type: 'reasoning', delta: event.delta.thinking }
      } else if (event.delta.type === 'input_json_delta') {
        yield { type: 'tool_call_arguments', index: event.index, delta: event.delta.partial_json }
      }
      continue
    }

    if (event.type === 'message_delta' && event.usage) {
      yield {
        type: 'usage',
        inputTokens: event.usage.input_tokens ?? 0,
        outputTokens: event.usage.output_tokens ?? 0,
      }
    }
  }
}
