/**
 * The fixed model set the hosted Copilot service accepts. In local mode the
 * picker is driven by `/api/copilot/models` instead, so this is only the hosted
 * fallback and the seed for a fresh chat.
 */
export const HOSTED_COPILOT_RUNTIME_MODELS = [
  'gpt-5.4',
  'gpt-5.4-mini',
  'claude-opus-4.6',
  'claude-sonnet-4.6',
] as const

/**
 * A model id is a plain string because local mode exposes whatever the operator's
 * providers offer, which no compile-time union can enumerate.
 */
export type CopilotRuntimeModel = string

export const DEFAULT_COPILOT_RUNTIME_MODEL: CopilotRuntimeModel = 'claude-sonnet-4.6'

export const COPILOT_RUNTIME_MODEL_OPTIONS: ReadonlyArray<{
  value: CopilotRuntimeModel
  label: CopilotRuntimeModel
}> = HOSTED_COPILOT_RUNTIME_MODELS.map((model) => ({
  value: model,
  label: model,
}))
