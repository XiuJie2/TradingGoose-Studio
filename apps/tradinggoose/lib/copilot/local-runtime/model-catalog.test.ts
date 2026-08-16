/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolvers = vi.hoisted(() => ({
  openai: vi.fn(),
  anthropic: vi.fn(),
  deepseek: vi.fn(),
  openrouter: vi.fn(),
  nvidia: vi.fn(),
  minimax: vi.fn(),
  ollama: vi.fn(),
}))

vi.mock('@/lib/system-services/runtime', () => ({
  resolveOpenAIServiceConfig: () => resolvers.openai(),
  resolveAnthropicServiceConfig: () => resolvers.anthropic(),
  resolveDeepseekServiceConfig: () => resolvers.deepseek(),
  resolveOpenRouterServiceConfig: () => resolvers.openrouter(),
  resolveNvidiaServiceConfig: () => resolvers.nvidia(),
  resolveMinimaxServiceConfig: () => resolvers.minimax(),
  resolveOllamaServiceConfig: () => resolvers.ollama(),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

describe('local copilot model catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    resolvers.openai.mockResolvedValue({ rotationKeys: [] })
    resolvers.anthropic.mockResolvedValue({ rotationKeys: [] })
    resolvers.deepseek.mockResolvedValue({ rotationKeys: [], apiKey: null })
    resolvers.openrouter.mockResolvedValue({ rotationKeys: [], apiKey: null })
    resolvers.nvidia.mockResolvedValue({
      rotationKeys: [],
      apiKey: null,
      baseUrl: 'https://integrate.api.nvidia.com/v1',
    })
    resolvers.minimax.mockResolvedValue({
      rotationKeys: [],
      apiKey: null,
      baseUrl: 'https://api.minimax.io/v1',
    })
    resolvers.ollama.mockResolvedValue({ baseUrl: 'http://localhost:11434' })
    // Ollama is listed unconditionally; nothing here should reach the network.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
  })

  it('leaves MiniMax out until a key is configured', async () => {
    const { listLocalCopilotModelGroups } = await import('./model-catalog')

    const groups = await listLocalCopilotModelGroups()

    expect(groups.find((group) => group.provider === 'minimax')).toBeUndefined()
  })

  it('lists MiniMax models under the provider prefix the runtime strips back off', async () => {
    resolvers.minimax.mockResolvedValue({
      rotationKeys: [],
      apiKey: 'system-minimax-key',
      baseUrl: 'https://api.minimax.io/v1',
    })

    const { listLocalCopilotModelGroups } = await import('./model-catalog')
    const { stripProviderPrefix } = await import('./providers')

    const group = (await listLocalCopilotModelGroups()).find(
      (candidate) => candidate.provider === 'minimax'
    )

    expect(group?.label).toBe('MiniMax')
    expect(group?.models).toContain('minimax/MiniMax-M2.7')
    // Every id has to survive the round trip, or the picker sends the model
    // upstream still namespaced and MiniMax rejects it.
    for (const model of group?.models ?? []) {
      expect(model.startsWith('minimax/')).toBe(true)
      expect(stripProviderPrefix('minimax', model)).not.toContain('/')
    }
  })

  it('picks up a rotation key when no single API key is set', async () => {
    resolvers.minimax.mockResolvedValue({
      rotationKeys: ['rotating-key'],
      apiKey: null,
      baseUrl: 'https://api.minimax.io/v1',
    })

    const { listLocalCopilotModelGroups } = await import('./model-catalog')

    const groups = await listLocalCopilotModelGroups()

    expect(groups.find((group) => group.provider === 'minimax')?.models.length).toBeGreaterThan(0)
  })
})
