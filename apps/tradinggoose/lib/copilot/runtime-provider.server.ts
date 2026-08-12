import { resolveCopilotRuntimeProvider } from '@/lib/copilot/runtime-provider'
import type { CopilotProviderConfig } from '@/lib/copilot/types'
import { resolveCopilotApiServiceConfig } from '@/lib/system-services/runtime'
import type { ProviderId } from '@/providers/ai/types'

export async function buildCopilotRuntimeProviderConfig(params: {
  model: string
  provider?: string
}): Promise<{
  provider: ProviderId
  providerConfig: CopilotProviderConfig
}> {
  const provider = resolveCopilotRuntimeProvider(params.model, params.provider)
  const copilotApi = await resolveCopilotApiServiceConfig()

  return {
    provider,
    providerConfig: {
      provider,
      model: params.model,
      apiKey: copilotApi.apiKey ?? undefined,
    },
  }
}
