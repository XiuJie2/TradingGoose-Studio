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

describe('default model selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    resolvers.openai.mockResolvedValue({ rotationKeys: ['openai-key'] })
    resolvers.anthropic.mockResolvedValue({ rotationKeys: ['anthropic-key'] })
    resolvers.deepseek.mockResolvedValue({ rotationKeys: [], apiKey: null })
    resolvers.openrouter.mockResolvedValue({ rotationKeys: [], apiKey: null })
    resolvers.nvidia.mockResolvedValue({
      rotationKeys: [],
      apiKey: null,
      baseUrl: 'https://integrate.api.nvidia.com/v1',
    })
    resolvers.minimax.mockResolvedValue({
      rotationKeys: [],
      apiKey: 'minimax-key',
      baseUrl: 'https://api.minimax.io/v1',
    })
    resolvers.ollama.mockResolvedValue({ baseUrl: 'http://localhost:11434' })
  })

  // `/api/copilot/models` reports `groups[0].models[0]` as the default and the
  // picker seeds a fresh chat with it, so group order and in-group order are
  // together the entire mechanism that decides the default model.
  it('puts MiniMax first even when OpenAI and Anthropic have keys', async () => {
    const { listLocalCopilotModelGroups } = await import('./model-catalog')

    const groups = await listLocalCopilotModelGroups()

    expect(groups[0]?.provider).toBe('minimax')
  })

  it('leads with the model the catalog nominates, not the first one listed', async () => {
    const { listLocalCopilotModelGroups } = await import('./model-catalog')
    const { PROVIDER_DEFINITIONS } = await import('@/providers/ai/models')

    const groups = await listLocalCopilotModelGroups()
    const minimax = groups.find((group) => group.provider === 'minimax')

    // The catalog lists MiniMax-M3 first but nominates MiniMax-M2.7, so without
    // the hoist the default would silently be whichever id sits at the top.
    expect(minimax?.models[0]).toBe(`minimax/${PROVIDER_DEFINITIONS.minimax.defaultModel}`)
    expect(minimax?.models[0]).toBe('minimax/MiniMax-M2.7')
  })

  it('keeps every other MiniMax model available', async () => {
    const { listLocalCopilotModelGroups } = await import('./model-catalog')
    const { PROVIDER_DEFINITIONS } = await import('@/providers/ai/models')

    const groups = await listLocalCopilotModelGroups()
    const minimax = groups.find((group) => group.provider === 'minimax')

    // Hoisting reorders; it must not drop anything.
    expect(minimax?.models).toHaveLength(PROVIDER_DEFINITIONS.minimax.models.length)
    expect(new Set(minimax?.models)).toEqual(
      new Set(PROVIDER_DEFINITIONS.minimax.models.map((model) => `minimax/${model.id}`))
    )
  })

  it('still offers OpenAI and Anthropic, just not first', async () => {
    const { listLocalCopilotModelGroups } = await import('./model-catalog')

    const providers = (await listLocalCopilotModelGroups()).map((group) => group.provider)

    expect(providers).toContain('openai')
    expect(providers).toContain('anthropic')
  })

  it('falls back to the next provider when MiniMax has no key', async () => {
    resolvers.minimax.mockResolvedValue({
      rotationKeys: [],
      apiKey: null,
      baseUrl: 'https://api.minimax.io/v1',
    })
    const { listLocalCopilotModelGroups } = await import('./model-catalog')

    const groups = await listLocalCopilotModelGroups()

    expect(groups[0]?.provider).toBe('openai')
  })
})
