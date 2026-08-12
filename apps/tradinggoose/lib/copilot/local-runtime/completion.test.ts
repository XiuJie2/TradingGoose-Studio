/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmStreamDelta } from '@/lib/copilot/local-runtime/types'

const { mockStreamLlm, mockGetApiKey, mockListGroups } = vi.hoisted(() => ({
  mockStreamLlm: vi.fn(),
  mockGetApiKey: vi.fn(),
  mockListGroups: vi.fn(),
}))

vi.mock('@/lib/copilot/local-runtime/llm', () => ({
  streamLlm: (...args: unknown[]) => mockStreamLlm(...args),
}))

vi.mock('@/lib/copilot/local-runtime/model-catalog', () => ({
  listLocalCopilotModelGroups: (...args: unknown[]) => mockListGroups(...args),
}))

vi.mock('@/providers/ai/utils-server', () => ({
  getApiKey: (...args: unknown[]) => mockGetApiKey(...args),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

function deltaStream(deltas: LlmStreamDelta[]) {
  return (async function* () {
    for (const delta of deltas) yield delta
  })()
}

describe('local copilot completion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetApiKey.mockResolvedValue('test-key')
    mockListGroups.mockResolvedValue([])
    mockStreamLlm.mockReturnValue(deltaStream([{ type: 'text', delta: 'A title' }]))
  })

  it('returns an OpenAI-shaped body when streaming is off', async () => {
    const { handleLocalCopilotCompletion } = await import('./completion')

    const response = await handleLocalCopilotCompletion({
      stream: false,
      model: 'anthropic/claude-sonnet-4.6',
      messages: [
        { role: 'system', content: 'name it' },
        { role: 'user', content: 'hello' },
      ],
    })

    expect(await response.json()).toEqual({
      choices: [{ message: { role: 'assistant', content: 'A title' } }],
    })
    expect(mockStreamLlm.mock.calls[0][0]).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-4.6',
      systemPrompt: 'name it',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
    })
  })

  it('consumes only the leading segment as the provider for reseller model ids', async () => {
    const { handleLocalCopilotCompletion } = await import('./completion')

    await handleLocalCopilotCompletion({
      stream: false,
      model: 'nvidia/meta/llama-3.3-70b-instruct',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(mockStreamLlm.mock.calls[0][0]).toMatchObject({
      provider: 'nvidia',
      model: 'meta/llama-3.3-70b-instruct',
    })
  })

  it('falls back to a configured provider when the requested model has no key', async () => {
    mockGetApiKey.mockRejectedValueOnce(new Error('API key is required for anthropic'))
    mockListGroups.mockResolvedValue([
      { provider: 'nvidia', label: 'NVIDIA NIM', models: ['nvidia/meta/llama-3.3-70b-instruct'] },
    ])

    const { handleLocalCopilotCompletion } = await import('./completion')
    await handleLocalCopilotCompletion({
      stream: false,
      model: 'anthropic/claude-sonnet-4.6',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(mockStreamLlm.mock.calls[0][0]).toMatchObject({
      provider: 'nvidia',
      model: 'nvidia/meta/llama-3.3-70b-instruct',
    })
  })

  it('reports a clear error when nothing is configured', async () => {
    mockGetApiKey.mockRejectedValue(new Error('API key is required'))

    const { handleLocalCopilotCompletion } = await import('./completion')
    const response = await handleLocalCopilotCompletion({
      stream: false,
      model: 'anthropic/claude-sonnet-4.6',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(response.status).toBe(503)
    expect(mockStreamLlm).not.toHaveBeenCalled()
  })

  it('emits OpenAI delta chunks and a [DONE] sentinel when streaming', async () => {
    mockStreamLlm.mockReturnValue(
      deltaStream([
        { type: 'reasoning', delta: 'ignored' },
        { type: 'text', delta: 'part-1' },
        { type: 'text', delta: 'part-2' },
      ])
    )

    const { handleLocalCopilotCompletion } = await import('./completion')
    const response = await handleLocalCopilotCompletion({
      stream: true,
      model: 'anthropic/claude-sonnet-4.6',
      messages: [{ role: 'user', content: 'hi' }],
    })

    const text = await response.text()
    expect(text).toContain('data: {"choices":[{"delta":{"content":"part-1"}}]}')
    expect(text).toContain('data: {"choices":[{"delta":{"content":"part-2"}}]}')
    expect(text).not.toContain('ignored')
    expect(text.trimEnd().endsWith('data: [DONE]')).toBe(true)
  })
})
