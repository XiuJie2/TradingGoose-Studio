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

/**
 * Seeds a fresh chat before `/api/copilot/models` answers, and backs the model
 * field on the chat route.
 *
 * This deployment runs Copilot on its own MiniMax key, so the seed is a MiniMax
 * id rather than a hosted one. The picker replaces it as soon as the model list
 * loads, and it moves a stored selection off any model this deployment cannot
 * serve, so a deployment on the hosted service still lands on a usable model —
 * it just shows this label for the first frame.
 */
export const DEFAULT_COPILOT_RUNTIME_MODEL: CopilotRuntimeModel = 'minimax/MiniMax-M2.7'

export const COPILOT_RUNTIME_MODEL_OPTIONS: ReadonlyArray<{
  value: CopilotRuntimeModel
  label: CopilotRuntimeModel
}> = HOSTED_COPILOT_RUNTIME_MODELS.map((model) => ({
  value: model,
  label: model,
}))
