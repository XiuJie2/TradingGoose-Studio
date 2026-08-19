import { createLogger } from '@/lib/logs/console/logger'
import { resolveOpenCodeServiceConfig } from '@/lib/system-services/runtime'
import { OPENCODE_BASE_URL_DEFAULT, OPENCODE_REQUEST_TIMEOUT_MS } from './constants'

const logger = createLogger('OpenCodeClient')

/**
 * A failure OpenCode itself reported, as opposed to a transport failure. The
 * two are fixed in completely different places — an unreachable host is a
 * deployment/network problem, a provider error is the OpenCode server's model
 * configuration — so the block surfaces them as distinct messages.
 */
export class OpenCodeError extends Error {
  readonly name = 'OpenCodeError'
}

export interface OpenCodeConnection {
  baseUrl: string
  authHeader: string | null
}

export interface OpenCodePromptResult {
  content: string
  sessionId: string
  agent: string
  providerId: string | null
  modelId: string | null
}

interface OpenCodeMessagePart {
  type?: string
  text?: string
}

interface OpenCodeMessageResponse {
  info?: {
    error?: { name?: string; data?: { message?: string } }
    providerID?: string
    modelID?: string
  }
  parts?: OpenCodeMessagePart[]
}

/**
 * Resolves the admin-configured connection.
 *
 * The base URL deliberately comes from Admin > Services and never from the
 * workflow: a block that accepted an arbitrary host would let any user of the
 * deployment aim server-side requests at the internal network. OpenCode is
 * configured once by the operator, exactly like Ollama.
 */
export async function resolveOpenCodeConnection(): Promise<OpenCodeConnection> {
  const config = await resolveOpenCodeServiceConfig()
  const baseUrl = (config.baseUrl ?? OPENCODE_BASE_URL_DEFAULT).replace(/\/+$/, '')

  // OpenCode's own server has no auth; installs are commonly fronted by basic
  // auth, so credentials are optional and only sent when both halves are set.
  const authHeader =
    config.username && config.password
      ? `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`
      : null

  return { baseUrl, authHeader }
}

function buildHeaders(connection: OpenCodeConnection): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (connection.authHeader) {
    headers.Authorization = connection.authHeader
  }
  return headers
}

/**
 * Parses a response body as JSON, naming what arrived when it is not JSON.
 *
 * A misconfigured address does not fail loudly: OpenCode's web UI answers any
 * unmatched path with its SPA shell at HTTP 200 and `text/html`, so
 * `/session` against a URL that reaches the UI but not the API returns a
 * successful-looking response full of markup. Reporting the status and
 * content-type turns "Unexpected token <" into a message that names the cause.
 */
async function decodeJson<T>(response: Response, context: string): Promise<T> {
  const text = await response.text()
  const contentType = response.headers.get('content-type')

  try {
    return JSON.parse(text) as T
  } catch {
    throw new OpenCodeError(
      `OpenCode ${context} returned ${response.status} ${contentType ?? 'with no content-type'} ` +
        `instead of JSON. Check that the Base URL points at the OpenCode API: ${text.slice(0, 200)}`
    )
  }
}

async function requestOpenCode(
  connection: OpenCodeConnection,
  path: string,
  init: RequestInit,
  context: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(`${connection.baseUrl}${path}`, {
      ...init,
      headers: buildHeaders(connection),
      signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new OpenCodeError(`OpenCode ${context} timed out after ${timeoutMs}ms`)
    }
    throw new OpenCodeError(
      `Could not reach the OpenCode server at ${connection.baseUrl}: ` +
        `${error instanceof Error ? error.message : String(error)}`
    )
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    const body = (await response.text()).slice(0, 300)
    throw new OpenCodeError(`OpenCode ${context} failed with ${response.status}: ${body}`)
  }

  return response
}

export interface OpenCodeAgent {
  name: string
  description: string | null
  native: boolean
}

/**
 * Lists the agents the configured server defines.
 *
 * Agent names are install-specific — a server can define any number of them —
 * so the block reads the live list instead of carrying a hardcoded one that
 * would be wrong on every deployment but the one it was written against.
 */
export async function listOpenCodeAgents(connection: OpenCodeConnection): Promise<OpenCodeAgent[]> {
  const response = await requestOpenCode(
    connection,
    '/agent',
    { method: 'GET' },
    'agent listing',
    30_000
  )

  const agents = await decodeJson<unknown>(response, 'agent listing')
  if (!Array.isArray(agents)) {
    throw new OpenCodeError('OpenCode agent listing did not return an array')
  }

  return agents
    .map((entry) => {
      const agent = entry as { name?: unknown; description?: unknown; native?: unknown }
      return {
        name: typeof agent.name === 'string' ? agent.name : '',
        description: typeof agent.description === 'string' ? agent.description : null,
        native: agent.native === true,
      }
    })
    .filter((agent) => agent.name.length > 0)
}

export async function createOpenCodeSession(
  connection: OpenCodeConnection,
  directory?: string
): Promise<string> {
  const query = directory ? `?directory=${encodeURIComponent(directory)}` : ''
  const response = await requestOpenCode(
    connection,
    `/session${query}`,
    { method: 'POST' },
    'session creation',
    60_000
  )

  const session = await decodeJson<{ id?: string }>(response, 'session creation')
  if (!session.id) {
    throw new OpenCodeError('OpenCode created a session without returning an id')
  }

  return session.id
}

/**
 * Sends one prompt and waits for the complete reply.
 *
 * OpenCode answers HTTP 200 even when the underlying model call fails — the
 * failure arrives as `info.error` alongside an empty `parts` array. So a 2xx is
 * not evidence of success here, and skipping that check would report a provider
 * outage as a blank answer, which reads as "the agent had nothing to say".
 */
export async function promptOpenCodeSession(
  connection: OpenCodeConnection,
  options: { sessionId: string; prompt: string; agent: string; timeoutMs?: number }
): Promise<OpenCodePromptResult> {
  const response = await requestOpenCode(
    connection,
    `/session/${encodeURIComponent(options.sessionId)}/message`,
    {
      method: 'POST',
      body: JSON.stringify({
        agent: options.agent,
        parts: [{ type: 'text', text: options.prompt }],
      }),
    },
    'prompt',
    options.timeoutMs ?? OPENCODE_REQUEST_TIMEOUT_MS
  )

  const data = await decodeJson<OpenCodeMessageResponse>(response, 'prompt')
  const info = data.info ?? {}

  if (info.error) {
    const detail = info.error.data?.message ?? info.error.name ?? 'unknown error'
    const model = [info.providerID, info.modelID].filter(Boolean).join('/')
    throw new OpenCodeError(
      `OpenCode model call failed${model ? ` (${model})` : ''}: ${detail.slice(0, 400)}`
    )
  }

  const content = (data.parts ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n')
    .trim()

  if (!content) {
    logger.warn('OpenCode returned no text parts', { sessionId: options.sessionId })
  }

  return {
    content,
    sessionId: options.sessionId,
    agent: options.agent,
    providerId: info.providerID ?? null,
    modelId: info.modelID ?? null,
  }
}
