import { getProviderFromModel } from '@/providers/ai/models'
import type { ProviderId } from '@/providers/ai/types'

export const COPILOT_RUNTIME_PROVIDER_IDS = [
  'openai',
  'anthropic',
] as const satisfies readonly ProviderId[]

export function deriveCopilotProviderFromModel(model: string): ProviderId {
  const normalized = model.trim().toLowerCase()

  // The hosted service's own ids (`gpt-5.4`, `claude-sonnet-4.6`) are not in the
  // model catalog, so they are matched by prefix before falling back to it.
  if (normalized.startsWith('gpt-')) {
    return 'openai'
  }

  if (normalized.startsWith('claude-')) {
    return 'anthropic'
  }

  return getProviderFromModel(normalized)
}

/**
 * `requestedProvider` is an untrusted string from the request body: the model is
 * authoritative, so a mismatched or unknown value is simply discarded.
 */
export function resolveCopilotRuntimeProvider(
  model: string,
  _requestedProvider?: string
): ProviderId {
  return deriveCopilotProviderFromModel(model)
}
