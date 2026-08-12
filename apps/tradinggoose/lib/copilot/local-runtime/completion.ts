import { streamLlm } from '@/lib/copilot/local-runtime/llm'
import { listLocalCopilotModelGroups } from '@/lib/copilot/local-runtime/model-catalog'
import { isLocalCopilotProvider } from '@/lib/copilot/local-runtime/providers'
import type { LocalCopilotMessage } from '@/lib/copilot/local-runtime/types'
import { createLogger } from '@/lib/logs/console/logger'
import { encodeSSE } from '@/lib/utils'
import { getProviderFromModel } from '@/providers/ai/models'
import type { ProviderId } from '@/providers/ai/types'
import { getApiKey } from '@/providers/ai/utils-server'

const logger = createLogger('LocalCopilotCompletion')

interface CompletionMessage {
  role: string
  content: string
}

/**
 * Callers format the model as `provider/model` (see `formatCompletionModel`), but
 * a reseller id is itself a prefix of the model — `nvidia/meta/llama-3.3` — so
 * only the leading segment is consumed as the provider.
 */
function parseCompletionModel(raw: string): { provider: ProviderId; model: string } {
  const separator = raw.indexOf('/')
  if (separator > 0) {
    const head = raw.slice(0, separator)
    if (isLocalCopilotProvider(head)) {
      return { provider: head, model: raw.slice(separator + 1) }
    }
  }

  return { provider: getProviderFromModel(raw), model: raw }
}

/**
 * Resolves a usable model. Callers such as the wand ask for the hosted default,
 * which a local deployment may not serve at all, so an unusable request falls
 * back to whatever this deployment does have rather than failing outright.
 */
async function resolveUsableModel(
  raw: string
): Promise<{ provider: ProviderId; model: string; apiKey: string } | null> {
  const requested = parseCompletionModel(raw)

  if (isLocalCopilotProvider(requested.provider)) {
    try {
      return { ...requested, apiKey: await getApiKey(requested.provider, requested.model) }
    } catch {
      // Falls through to the catalog below.
    }
  }

  const groups = await listLocalCopilotModelGroups()
  for (const group of groups) {
    const model = group.models[0]
    if (!model || !isLocalCopilotProvider(group.provider)) continue
    try {
      return {
        provider: group.provider,
        model,
        apiKey: await getApiKey(group.provider, model),
      }
    } catch {
      // Try the next provider.
    }
  }

  return null
}

function splitMessages(messages: CompletionMessage[]): {
  systemPrompt: string
  conversation: LocalCopilotMessage[]
} {
  const systemParts: string[] = []
  const conversation: LocalCopilotMessage[] = []

  for (const message of messages) {
    if (message.role === 'system') {
      systemParts.push(message.content)
      continue
    }

    if (message.role === 'assistant') {
      conversation.push({ role: 'assistant', content: message.content })
      continue
    }

    conversation.push({ role: 'user', content: message.content })
  }

  return { systemPrompt: systemParts.join('\n\n'), conversation }
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Serves the hosted service's `/api/completion` endpoint locally. It is a plain
 * OpenAI-shaped chat completion — no tools, no conversation state — used for chat
 * titles and the wand, so the response mirrors that wire format exactly.
 */
export async function handleLocalCopilotCompletion(
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Response> {
  const rawModel = typeof body.model === 'string' ? body.model : ''
  const messages = Array.isArray(body.messages) ? (body.messages as CompletionMessage[]) : []
  const wantsStream = body.stream === true

  const resolved = await resolveUsableModel(rawModel)
  if (!resolved) {
    logger.warn('No usable local model for completion', { requested: rawModel })
    return jsonError('No model provider is configured for local Copilot completions.', 503)
  }

  const { systemPrompt, conversation } = splitMessages(messages)

  const deltas = streamLlm({
    provider: resolved.provider,
    model: resolved.model,
    apiKey: resolved.apiKey,
    systemPrompt,
    messages: conversation,
    tools: [],
    signal,
  })

  if (!wantsStream) {
    let content = ''
    for await (const delta of deltas) {
      if (delta.type === 'text') content += delta.delta
    }

    return new Response(
      JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const delta of deltas) {
          if (delta.type !== 'text') continue
          controller.enqueue(encodeSSE({ choices: [{ delta: { content: delta.delta } }] }))
        }
      } catch (error) {
        logger.error('Local completion stream failed', error)
        controller.enqueue(
          encodeSSE({ error: error instanceof Error ? error.message : 'Completion failed' })
        )
      }

      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
      controller.close()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
