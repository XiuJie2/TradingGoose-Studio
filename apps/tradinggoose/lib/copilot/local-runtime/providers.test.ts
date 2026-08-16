/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'
import {
  LOCAL_COPILOT_PROVIDERS,
  listLocalCopilotProviderNames,
} from '@/lib/copilot/local-runtime/providers'

// Imported for its module-level side effects only; the resolvers are never
// called by the name lookup under test.
vi.mock('@/lib/system-services/runtime', () => ({
  resolveNvidiaServiceConfig: async () => ({ baseUrl: 'https://integrate.api.nvidia.com/v1' }),
  resolveMinimaxServiceConfig: async () => ({ baseUrl: 'https://api.minimax.io/v1' }),
  resolveOllamaServiceConfig: async () => ({ baseUrl: 'http://localhost:11434' }),
}))

describe('listLocalCopilotProviderNames', () => {
  // The sentence this feeds used to be maintained by hand and had gone stale,
  // telling operators that a model the runtime can actually drive is
  // unsupported. Asserting full coverage is what stops that recurring.
  it('names every provider the runtime can drive', () => {
    const names = listLocalCopilotProviderNames()

    expect(names.split(', ')).toHaveLength(LOCAL_COPILOT_PROVIDERS.length)
    for (const provider of ['xAI', 'Mistral', 'Fireworks', 'MiniMax', 'NVIDIA NIM']) {
      expect(names).toContain(provider)
    }
  })

  it('never falls back to a raw provider id', () => {
    // A missing PROVIDER_DEFINITIONS entry degrades to the bare id, which would
    // put `xai` in front of an operator instead of `xAI`.
    expect(listLocalCopilotProviderNames()).not.toMatch(/\b(xai|openrouter|minimax|nvidia)\b/)
  })
})
