/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalCopilotMessage } from '@/lib/copilot/local-runtime/types'

const { mockOpenAiCreate, mockAnthropicStream } = vi.hoisted(() => ({
  mockOpenAiCreate: vi.fn(),
  mockAnthropicStream: vi.fn(),
}))

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: (...args: unknown[]) => mockOpenAiCreate(...args) } }
  },
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { stream: (...args: unknown[]) => mockAnthropicStream(...args) }
  },
}))

vi.mock('@/lib/system-services/runtime', () => ({
  resolveNvidiaServiceConfig: async () => ({ baseUrl: 'https://integrate.api.nvidia.com/v1' }),
  resolveMinimaxServiceConfig: async () => ({ baseUrl: 'https://api.minimax.io/v1' }),
  resolveOllamaServiceConfig: async () => ({ baseUrl: 'http://localhost:11434' }),
}))

async function* emptyStream() {}

const CONVERSATION: LocalCopilotMessage[] = [
  { role: 'user', content: 'read both workflows' },
  {
    role: 'assistant',
    content: '',
    toolCalls: [
      { id: 'call-1', name: 'read_workflow', arguments: '{"entityId":"a"}' },
      { id: 'call-2', name: 'read_workflow', arguments: '{"entityId":"b"}' },
    ],
  },
  { role: 'tool', toolCallId: 'call-1', name: 'read_workflow', content: '{"blocks":1}' },
  { role: 'tool', toolCallId: 'call-2', name: 'read_workflow', content: '{"blocks":2}' },
]

const TOOLS = [{ name: 'read_workflow', description: 'Read a workflow.', parameters: {} }]

async function drain(generator: AsyncGenerator<unknown>) {
  for await (const _ of generator) {
    // consume
  }
}

describe('local copilot llm adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOpenAiCreate.mockResolvedValue(emptyStream())
    mockAnthropicStream.mockReturnValue(emptyStream())
  })

  it('strips the provider prefix and points NVIDIA at its configured base URL', async () => {
    const { streamLlm } = await import('./llm')

    await drain(
      streamLlm({
        provider: 'nvidia',
        model: 'nvidia/meta/llama-3.3-70b-instruct',
        apiKey: 'k',
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
        tools: TOOLS,
      })
    )

    expect(mockOpenAiCreate.mock.calls[0][0].model).toBe('meta/llama-3.3-70b-instruct')
  })

  it('asks MiniMax to split its thinking out of the answer', async () => {
    const { streamLlm } = await import('./llm')

    await drain(
      streamLlm({
        provider: 'minimax',
        model: 'minimax/MiniMax-M2.7',
        apiKey: 'k',
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
        tools: TOOLS,
      })
    )

    const body = mockOpenAiCreate.mock.calls[0][0]
    expect(body.model).toBe('MiniMax-M2.7')
    // Thinking cannot be disabled on M2.x. Without this the reply arrives with
    // `<think>...</think>` sitting in `content`, which renders as literal markup.
    expect(body.reasoning_split).toBe(true)
    // The catalog entry has to be found, otherwise the shared fallback would cap
    // the reply at 4096 tokens.
    expect(body.max_tokens).toBe(65536)
  })

  it('sends the MiniMax-only body field to nobody else', async () => {
    const { streamLlm } = await import('./llm')

    await drain(
      streamLlm({
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        apiKey: 'k',
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
        tools: TOOLS,
      })
    )

    expect(mockOpenAiCreate.mock.calls[0][0]).not.toHaveProperty('reasoning_split')
  })

  it('maps tool calls and results onto the OpenAI chat shape', async () => {
    const { streamLlm } = await import('./llm')

    await drain(
      streamLlm({
        provider: 'openai',
        model: 'gpt-5.4',
        apiKey: 'k',
        systemPrompt: 'sys',
        messages: CONVERSATION,
        tools: TOOLS,
      })
    )

    expect(mockOpenAiCreate.mock.calls[0][0].messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'read both workflows' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'read_workflow', arguments: '{"entityId":"a"}' },
          },
          {
            id: 'call-2',
            type: 'function',
            function: { name: 'read_workflow', arguments: '{"entityId":"b"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call-1', content: '{"blocks":1}' },
      { role: 'tool', tool_call_id: 'call-2', content: '{"blocks":2}' },
    ])
  })

  it('collapses parallel tool results into one Anthropic user turn', async () => {
    const { streamLlm } = await import('./llm')

    await drain(
      streamLlm({
        provider: 'anthropic',
        model: 'claude-sonnet-4.6',
        apiKey: 'k',
        systemPrompt: 'sys',
        messages: CONVERSATION,
        tools: TOOLS,
      })
    )

    // Anthropic rejects two consecutive user turns, so both tool results have to
    // land in the same message.
    expect(mockAnthropicStream.mock.calls[0][0].messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'read both workflows' }] },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call-1', name: 'read_workflow', input: { entityId: 'a' } },
          { type: 'tool_use', id: 'call-2', name: 'read_workflow', input: { entityId: 'b' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call-1', content: '{"blocks":1}' },
          { type: 'tool_result', tool_use_id: 'call-2', content: '{"blocks":2}' },
        ],
      },
    ])
  })

  it('normalizes OpenAI-style reasoning and tool call fragments into deltas', async () => {
    mockOpenAiCreate.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { reasoning_content: 'weighing' } }] }
        yield { choices: [{ delta: { content: 'ok' } }] }
        yield {
          choices: [
            {
              delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_workflow' } }] },
            },
          ],
        }
        yield {
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":1}' } }] } }],
        }
      })()
    )

    const { streamLlm } = await import('./llm')
    const deltas: unknown[] = []
    for await (const delta of streamLlm({
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'k',
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: TOOLS,
    })) {
      deltas.push(delta)
    }

    expect(deltas).toEqual([
      { type: 'reasoning', delta: 'weighing' },
      { type: 'text', delta: 'ok' },
      { type: 'tool_call_start', index: 0, id: 'c1', name: 'read_workflow' },
      { type: 'tool_call_arguments', index: 0, delta: '{"a":1}' },
    ])
  })
})
