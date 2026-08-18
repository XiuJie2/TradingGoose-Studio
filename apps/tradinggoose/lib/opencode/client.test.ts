/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock is hoisted above the module scope, so the spy it returns has to be
// created inside vi.hoisted or it is still in the temporal dead zone when the
// factory runs.
const { resolveOpenCodeServiceConfig } = vi.hoisted(() => ({
  resolveOpenCodeServiceConfig: vi.fn(),
}))

vi.mock('@/lib/system-services/runtime', () => ({ resolveOpenCodeServiceConfig }))

import {
  createOpenCodeSession,
  OpenCodeError,
  promptOpenCodeSession,
  resolveOpenCodeConnection,
} from '@/lib/opencode/client'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const connection = { baseUrl: 'http://opencode.test:4096', authHeader: null }

describe('resolveOpenCodeConnection', () => {
  beforeEach(() => {
    resolveOpenCodeServiceConfig.mockReset()
  })

  it('sends basic auth only when both halves are configured', async () => {
    resolveOpenCodeServiceConfig.mockResolvedValue({
      baseUrl: 'http://host.docker.internal:4096',
      username: 'opencode',
      password: 'secret',
    })

    const withAuth = await resolveOpenCodeConnection()
    expect(withAuth.authHeader).toBe(`Basic ${Buffer.from('opencode:secret').toString('base64')}`)

    // A username with no password is a half-configured service, and sending
    // `user:` would authenticate as nobody while looking like it tried.
    resolveOpenCodeServiceConfig.mockResolvedValue({
      baseUrl: 'http://host.docker.internal:4096',
      username: 'opencode',
      password: null,
    })
    expect((await resolveOpenCodeConnection()).authHeader).toBeNull()
  })

  it('strips a trailing slash so paths do not double up', async () => {
    resolveOpenCodeServiceConfig.mockResolvedValue({
      baseUrl: 'http://host.docker.internal:4096/',
      username: null,
      password: null,
    })

    expect((await resolveOpenCodeConnection()).baseUrl).toBe('http://host.docker.internal:4096')
  })
})

describe('promptOpenCodeSession', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('joins the text parts and reports the model that answered', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        info: { providerID: 'minimax', modelID: 'MiniMax-M2.7' },
        parts: [
          { type: 'reasoning', text: 'thinking out loud' },
          { type: 'text', text: 'VIX 18.2' },
          { type: 'text', text: 'HY OAS 3.1%' },
        ],
      })
    )

    const result = await promptOpenCodeSession(connection, {
      sessionId: 'ses_1',
      prompt: 'summarise',
      agent: 'plan',
    })

    // Reasoning is not the answer; including it would put the agent's
    // scratchpad into whatever the next block sends out.
    expect(result.content).toBe('VIX 18.2\nHY OAS 3.1%')
    expect(result.modelId).toBe('MiniMax-M2.7')
    expect(result.providerId).toBe('minimax')
  })

  // OpenCode answers 200 when the model call itself fails, carrying the failure
  // in info.error with an empty parts list. Trusting the status code would
  // report a provider outage as an agent that simply had nothing to say.
  it('fails on an error reported inside a 200 response', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        info: {
          providerID: 'minimax',
          modelID: 'MiniMax-M2.7',
          error: { name: 'ProviderAuthError', data: { message: 'invalid api key' } },
        },
        parts: [],
      })
    )

    await expect(
      promptOpenCodeSession(connection, { sessionId: 'ses_1', prompt: 'x', agent: 'plan' })
    ).rejects.toThrow(/minimax\/MiniMax-M2\.7.*invalid api key/)
  })

  // The OpenCode web UI answers any unmatched path with its SPA shell at 200
  // and text/html, so a Base URL that reaches the UI but not the API produces a
  // successful-looking response full of markup.
  it('names the status and content-type when HTML arrives instead of JSON', async () => {
    fetchMock.mockResolvedValue(
      new Response('<!doctype html><html><title>OpenCode</title></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    )

    await expect(
      promptOpenCodeSession(connection, { sessionId: 'ses_1', prompt: 'x', agent: 'plan' })
    ).rejects.toThrow(/returned 200 text\/html instead of JSON/)
  })

  it('reports an unreachable host as a connection failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    await expect(
      promptOpenCodeSession(connection, { sessionId: 'ses_1', prompt: 'x', agent: 'plan' })
    ).rejects.toThrow(/Could not reach the OpenCode server at http:\/\/opencode\.test:4096/)
  })
})

describe('createOpenCodeSession', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes the working directory through as a query parameter', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'ses_new' }))

    const id = await createOpenCodeSession(connection, '/home/jie/Project/AI-Wealth-Manager')

    expect(id).toBe('ses_new')
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://opencode.test:4096/session?directory=%2Fhome%2Fjie%2FProject%2FAI-Wealth-Manager'
    )
  })

  it('rejects a session response with no id rather than prompting an empty one', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))

    await expect(createOpenCodeSession(connection)).rejects.toBeInstanceOf(OpenCodeError)
  })
})
