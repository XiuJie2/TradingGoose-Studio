export const COPILOT_API_URL_DEFAULT = 'https://copilot.tradinggoose.ai'
export const COPILOT_API_VERSION = '1.0'

export const COPILOT_RUNTIME_MODES = ['local', 'hosted'] as const
export type CopilotRuntimeMode = (typeof COPILOT_RUNTIME_MODES)[number]

/**
 * Self-hosted deployments have their own provider keys and no reason to pay for
 * the managed inference service, so the local runtime is the default. Set the
 * Copilot API service's Runtime Mode (or COPILOT_RUNTIME_MODE) to `hosted` to go
 * back to copilot.tradinggoose.ai.
 */
export const COPILOT_RUNTIME_MODE_DEFAULT: CopilotRuntimeMode = 'local'

export function parseCopilotRuntimeMode(value: string | undefined | null): CopilotRuntimeMode {
  const normalized = value?.trim().toLowerCase()
  return normalized === 'hosted' ? 'hosted' : COPILOT_RUNTIME_MODE_DEFAULT
}
