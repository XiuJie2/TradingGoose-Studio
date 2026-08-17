/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreate, mockResolveConfig, mockGetApiKey } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockResolveConfig: vi.fn(),
  mockGetApiKey: vi.fn(),
}))

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: (...args: unknown[]) => mockCreate(...args) } }
  },
}))

vi.mock('@/lib/system-services/runtime', () => ({
  resolveMinimaxServiceConfig: () => mockResolveConfig(),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/tools', () => ({ executeTool: vi.fn() }))

// The key now comes from the shared resolver rather than the service config, so
// that a rotation slot is honoured the same way it is for every other provider.
vi.mock('@/providers/ai/utils-server', () => ({
  getApiKey: (...args: unknown[]) => mockGetApiKey(...args),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockResolveConfig.mockResolvedValue({
    apiKey: 'minimax-key',
    rotationKeys: [],
    baseUrl: 'https://api.minimax.io/v1',
  })
  mockGetApiKey.mockResolvedValue('minimax-key')
  mockCreate.mockResolvedValue({
    choices: [{ message: { content: 'ok' } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  })
})

const sentModel = async (model: string) => {
  const { minimaxProvider } = await import('./index')
  await minimaxProvider.executeRequest({ model, systemPrompt: 'hi' })
  return (mockCreate.mock.calls[0]?.[0] as { model: string }).model
}

describe('minimax model id resolution', () => {
  // MiniMax ids are mixed-case and its API does not accept a lowercased id.
  // `getBaseModelProviders()` keys its map by `toLowerCase()`, so the workflow
  // Agent block offers `minimax-m2.7` — harmless for every other provider,
  // because their catalog ids are already lowercase.
  it.each([
    ['canonical', 'MiniMax-M2.7'],
    ['lowercased by the agent block picker', 'minimax-m2.7'],
    ['namespaced by the copilot picker', 'minimax/MiniMax-M2.7'],
    ['namespaced and lowercased', 'minimax/minimax-m2.7'],
  ])('sends the canonical id when given the %s form', async (_label, input) => {
    await expect(sentModel(input)).resolves.toBe('MiniMax-M2.7')
  })

  it('resolves every catalog id, not just the default', async () => {
    await expect(sentModel('minimax-m2.7-highspeed')).resolves.toBe('MiniMax-M2.7-highspeed')
  })

  it('passes an unknown id through so a newly shipped model still works', async () => {
    // The catalog is a static list; MiniMax shipping M4 must not require a
    // release here before it can be used.
    await expect(sentModel('minimax/MiniMax-M4')).resolves.toBe('MiniMax-M4')
  })
})
