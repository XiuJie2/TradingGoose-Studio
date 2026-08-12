import { COPILOT_API_URL_DEFAULT, COPILOT_API_VERSION } from '@/lib/copilot/agent/constants'
import { dispatchLocalCopilotRequest } from '@/lib/copilot/local-runtime/dispatch'
import { resolveCopilotApiServiceConfig } from '@/lib/system-services/runtime'

const COMPLETION_API_VERSION = 'v1'

export type CopilotProxyRequest = {
  endpoint: string
  body?: Record<string, unknown>
  signal?: AbortSignal
  headers?: Record<string, string>
  /**
   * Caller-authenticated user, for endpoints whose body does not carry one. The
   * local runtime needs it to scope conversation state; the hosted service
   * ignores it.
   */
  userId?: string
}

export type CopilotCompletionRequest = {
  body?: Record<string, unknown>
  signal?: AbortSignal
  headers?: Record<string, string>
}

type CopilotQuery = Record<string, string | number | boolean | null | undefined>

async function createRequestInit(
  body: Record<string, unknown> | undefined,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>
): Promise<RequestInit> {
  const copilotApi = await resolveCopilotApiServiceConfig()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const apiKey = copilotApi.apiKey
  if (apiKey) {
    headers['x-api-key'] = apiKey
  }
  Object.assign(headers, extraHeaders)

  return {
    method: 'POST',
    headers,
    signal,
    body: body ? JSON.stringify(body) : undefined,
  }
}

/** True when Copilot should run in this deployment instead of calling the hosted service. */
export async function isLocalCopilotMode(): Promise<boolean> {
  return (await resolveCopilotApiServiceConfig()).mode === 'local'
}

export async function getCopilotApiUrl(endpoint: string, query?: CopilotQuery) {
  const copilotApi = await resolveCopilotApiServiceConfig()
  const url = new URL(endpoint, copilotApi.baseUrl || COPILOT_API_URL_DEFAULT)
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

export async function proxyCopilotRequest({
  endpoint,
  body,
  signal,
  headers,
  userId,
}: CopilotProxyRequest) {
  if (await isLocalCopilotMode()) {
    return dispatchLocalCopilotRequest({ endpoint, body, userId, signal })
  }

  return fetch(
    await getCopilotApiUrl(endpoint),
    await createRequestInit(
      body ? { ...body, version: COPILOT_API_VERSION } : undefined,
      signal,
      headers
    )
  )
}

export async function proxyCopilotCompletionRequest({
  body,
  signal,
  headers,
}: CopilotCompletionRequest) {
  if (await isLocalCopilotMode()) {
    const { handleLocalCopilotCompletion } = await import('@/lib/copilot/local-runtime/completion')
    return handleLocalCopilotCompletion(body ?? {}, signal)
  }

  return fetch(
    await getCopilotApiUrl('/api/completion', { version: COMPLETION_API_VERSION }),
    await createRequestInit(body, signal, headers)
  )
}
