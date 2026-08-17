import { createLogger } from '@/lib/logs/console/logger'
import {
  resolveAnthropicServiceConfig,
  resolveDeepseekServiceConfig,
  resolveMinimaxServiceConfig,
  resolveNvidiaServiceConfig,
  resolveOllamaServiceConfig,
  resolveOpenAIServiceConfig,
  resolveOpenRouterServiceConfig,
} from '@/lib/system-services/runtime'
import { PROVIDER_DEFINITIONS } from '@/providers/ai/models'
import type { ProviderId } from '@/providers/ai/types'

const logger = createLogger('LocalCopilotModelCatalog')

export interface CopilotModelGroup {
  provider: ProviderId
  label: string
  models: string[]
}

/** Model listings are a network round trip per provider, so they are cached briefly. */
const LISTING_CACHE_MS = 5 * 60 * 1000

const listingCache = new Map<string, { models: string[]; expiresAt: number }>()

async function cachedListing(key: string, load: () => Promise<string[]>): Promise<string[]> {
  const cached = listingCache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.models
  }

  try {
    const models = await load()
    listingCache.set(key, { models, expiresAt: Date.now() + LISTING_CACHE_MS })
    return models
  } catch (error) {
    logger.warn('Failed to list models', { provider: key, error })
    return cached?.models ?? []
  }
}

/**
 * Moves the provider's declared `defaultModel` to the front of its list.
 *
 * The picker seeds a fresh chat with `groups[0].models[0]`, so without this the
 * default is whichever id happens to sit at the top of the catalog array rather
 * than the one the catalog nominates — MiniMax declares `MiniMax-M2.7` but lists
 * `MiniMax-M3` first. Ids are matched with an optional provider prefix because
 * namespaced providers publish `minimax/MiniMax-M2.7` while the catalog stores
 * the bare id.
 */
function withDeclaredDefaultFirst(provider: ProviderId, models: string[]): string[] {
  const declared = PROVIDER_DEFINITIONS[provider]?.defaultModel
  if (!declared) return models

  const index = models.findIndex((model) => model === declared || model.endsWith(`/${declared}`))
  if (index <= 0) return models

  return [models[index]!, ...models.slice(0, index), ...models.slice(index + 1)]
}

function staticModels(providerId: ProviderId): string[] {
  return (PROVIDER_DEFINITIONS[providerId]?.models ?? [])
    .filter((model) => !model.deprecated)
    .map((model) => model.id)
}

async function listOpenAiCompatibleModels(params: {
  baseUrl: string
  apiKey: string
  prefix: string
}): Promise<string[]> {
  const response = await fetch(`${params.baseUrl.replace(/\/$/, '')}/models`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    signal: AbortSignal.timeout(8000),
  })

  if (!response.ok) return []

  const data = (await response.json()) as { data?: Array<{ id: string }> }
  return Array.from(new Set((data.data ?? []).map((model) => `${params.prefix}${model.id}`)))
}

async function listOpenRouterToolModels(): Promise<string[]> {
  const response = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(8000),
  })

  if (!response.ok) return []

  const data = (await response.json()) as {
    data?: Array<{ id: string; supported_parameters?: string[] }>
  }

  // Copilot is useless without tool calling, so models that cannot take tools are
  // left out of the picker rather than failing at the first tool call.
  return (data.data ?? [])
    .filter((model) => model.supported_parameters?.includes('tools'))
    .map((model) => `openrouter/${model.id}`)
}

async function listOllamaModels(baseUrl: string): Promise<string[]> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, {
    signal: AbortSignal.timeout(5000),
  })

  if (!response.ok) return []

  const data = (await response.json()) as { models?: Array<{ name: string }> }
  return (data.models ?? []).map((model) => model.name)
}

/**
 * The models Copilot can run in local mode: every provider that has a usable key
 * in Admin > Services, with the dynamic providers listed live from their API.
 */
export async function listLocalCopilotModelGroups(): Promise<CopilotModelGroup[]> {
  const [openai, anthropic, deepseek, openrouter, nvidia, minimax, ollama] = await Promise.all([
    resolveOpenAIServiceConfig(),
    resolveAnthropicServiceConfig(),
    resolveDeepseekServiceConfig(),
    resolveOpenRouterServiceConfig(),
    resolveNvidiaServiceConfig(),
    resolveMinimaxServiceConfig(),
    resolveOllamaServiceConfig(),
  ])

  const groups: CopilotModelGroup[] = []

  const push = (provider: ProviderId, models: string[]) => {
    if (models.length === 0) return
    groups.push({
      provider,
      label: PROVIDER_DEFINITIONS[provider]?.name ?? provider,
      models: withDeclaredDefaultFirst(provider, models),
    })
  }

  // MiniMax first: `/api/copilot/models` seeds a fresh chat with
  // `groups[0].models[0]`, so this ordering is what actually decides the default
  // model in local mode. MiniMax publishes a short, stable model list, so the
  // static catalog is used rather than a `/models` round trip. That also keeps
  // each id's real output ceiling, which a dynamically discovered id would not
  // have.
  const minimaxKey = minimax.rotationKeys[0] ?? minimax.apiKey
  if (minimaxKey) {
    push(
      'minimax',
      staticModels('minimax').map((model) => `minimax/${model}`)
    )
  }

  if (openai.rotationKeys.length > 0) {
    push('openai', staticModels('openai'))
  }

  if (anthropic.rotationKeys.length > 0) {
    push('anthropic', staticModels('anthropic'))
  }

  const deepseekKey = deepseek.rotationKeys[0] ?? deepseek.apiKey
  if (deepseekKey) {
    push('deepseek', staticModels('deepseek'))
  }

  const openrouterKey = openrouter.rotationKeys[0] ?? openrouter.apiKey
  if (openrouterKey) {
    push('openrouter', await cachedListing('openrouter', listOpenRouterToolModels))
  }

  const nvidiaKey = nvidia.rotationKeys[0] ?? nvidia.apiKey
  if (nvidiaKey) {
    push(
      'nvidia',
      await cachedListing('nvidia', () =>
        listOpenAiCompatibleModels({
          baseUrl: nvidia.baseUrl,
          apiKey: nvidiaKey,
          prefix: 'nvidia/',
        })
      )
    )
  }

  push('ollama', await cachedListing('ollama', () => listOllamaModels(ollama.baseUrl)))

  return groups
}
