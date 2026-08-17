import {
  resolveMinimaxServiceConfig,
  resolveNvidiaServiceConfig,
  resolveOllamaServiceConfig,
} from '@/lib/system-services/runtime'
import { PROVIDER_DEFINITIONS } from '@/providers/ai/models'
import type { ProviderId } from '@/providers/ai/types'

/**
 * Providers the local Copilot runtime can drive. Everything except Anthropic
 * speaks the OpenAI chat-completions wire format, so they share one client and
 * differ only by base URL.
 */
export const LOCAL_COPILOT_OPENAI_COMPATIBLE_BASE_URLS: Partial<Record<ProviderId, string>> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  xai: 'https://api.x.ai/v1',
  mistral: 'https://api.mistral.ai/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
}

export const LOCAL_COPILOT_PROVIDERS = [
  'anthropic',
  'openai',
  'deepseek',
  'openrouter',
  'nvidia',
  'minimax',
  'ollama',
  'xai',
  'mistral',
  'fireworks',
] as const satisfies readonly ProviderId[]

export type LocalCopilotProvider = (typeof LOCAL_COPILOT_PROVIDERS)[number]

export function isLocalCopilotProvider(provider: string): provider is LocalCopilotProvider {
  return (LOCAL_COPILOT_PROVIDERS as readonly string[]).includes(provider)
}

/**
 * Display names for the "pick a supported model" error. Derived rather than
 * written out, because the hand-maintained sentence had already gone stale: it
 * still omitted xAI, Mistral and Fireworks, telling operators a model they can
 * actually run is unsupported.
 */
export function listLocalCopilotProviderNames(): string {
  return LOCAL_COPILOT_PROVIDERS.map(
    (provider) => PROVIDER_DEFINITIONS[provider]?.name ?? provider
  ).join(', ')
}

/**
 * Base URLs that come from Admin > Services rather than a constant, because the
 * operator points them at their own host.
 */
export async function resolveLocalCopilotBaseUrl(
  provider: ProviderId
): Promise<string | undefined> {
  if (provider === 'nvidia') {
    return (await resolveNvidiaServiceConfig()).baseUrl.replace(/\/$/, '')
  }

  if (provider === 'minimax') {
    return (await resolveMinimaxServiceConfig()).baseUrl.replace(/\/$/, '')
  }

  if (provider === 'ollama') {
    return `${(await resolveOllamaServiceConfig()).baseUrl.replace(/\/$/, '')}/v1`
  }

  return LOCAL_COPILOT_OPENAI_COMPATIBLE_BASE_URLS[provider]
}

/**
 * Model ids are namespaced in the picker (`nvidia/meta/llama-3.3-70b-instruct`)
 * but the upstream API only knows the unprefixed id.
 */
export function stripProviderPrefix(provider: ProviderId, model: string): string {
  const prefix = `${provider}/`
  return model.startsWith(prefix) ? model.slice(prefix.length) : model
}
