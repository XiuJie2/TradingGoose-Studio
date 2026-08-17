import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { buildCopilotServerToolErrorResponse } from '@/lib/copilot/server-tool-errors'
import { WatchlistDocumentError } from '@/lib/watchlists/validation'
import { WorkflowRealtimeRequiredError } from '@/lib/workflows/db-helpers'
import { SavedEntityRealtimeRequiredError } from '@/lib/yjs/entity-state'
import {
  SocketServerBridgeError,
  SocketServerNonJsonResponseError,
} from '@/lib/yjs/server/snapshot-bridge'
import { createDashboardLayoutValidationError } from '@/widgets/layout-document'
import { createWidgetConfigValidationError } from '@/widgets/widget-mutations'

describe('copilot server tool errors', () => {
  it('returns container repair guidance for invalid canonical container edge handles', () => {
    const response = buildCopilotServerToolErrorResponse(
      'edit_workflow',
      new Error(
        'Invalid container edge: parallel1 container input requires targetHandle "target" for incoming outer edges.'
      )
    )

    expect(response).toEqual({
      status: 422,
      body: expect.objectContaining({
        code: 'invalid_workflow_document_container_edge',
        retryable: true,
        issues: [
          {
            path: 'entityDocument.edges',
            message:
              'Invalid container edge: parallel1 container input requires targetHandle "target" for incoming outer edges.',
          },
        ],
      }),
    })
    expect(response.body.hint).toContain('connect outer edges')
  })

  it('preserves embedded workflow sub-block paths in structured edit errors', () => {
    const response = buildCopilotServerToolErrorResponse(
      'edit_workflow',
      new Error(
        'Invalid edited workflow: Document contract is inconsistent: invalid block sub-block values for functionBlock.subBlocks.code.value (Expected valid raw TypeScript function-body code.).'
      )
    )

    expect(response).toEqual({
      status: 422,
      body: expect.objectContaining({
        code: 'invalid_workflow_state',
        retryable: true,
        issues: [
          {
            path: 'entityDocument.functionBlock.subBlocks.code.value',
            message: 'Expected valid raw TypeScript function-body code.',
          },
        ],
      }),
    })
  })

  it('returns explicit removal guidance for omitted workflow blocks', () => {
    const response = buildCopilotServerToolErrorResponse(
      'edit_workflow',
      new Error(
        'Invalid edited workflow: Existing block ids omitted from edit_workflow entityDocument without removedBlockIds: fn1.'
      )
    )

    expect(response).toEqual({
      status: 422,
      body: expect.objectContaining({
        code: 'invalid_workflow_state',
        retryable: true,
      }),
    })
    expect(response.body.hint).toContain('removedBlockIds')
  })

  it('returns retryable graph-document guidance for malformed edit workflow Mermaid', () => {
    const response = buildCopilotServerToolErrorResponse(
      'edit_workflow',
      new Error('Workflow graph Mermaid must start with `flowchart TD` or `flowchart LR`.')
    )

    expect(response).toEqual({
      status: 422,
      body: expect.objectContaining({
        code: 'invalid_workflow_graph_document',
        retryable: true,
        issues: [
          {
            path: 'entityDocument',
            message: 'Workflow graph Mermaid must start with `flowchart TD` or `flowchart LR`.',
          },
        ],
      }),
    })
    expect(response.body.hint).toContain('minimal Mermaid graph')
  })

  it('falls back to a generic 500 payload for non-structured failures', () => {
    const response = buildCopilotServerToolErrorResponse(
      'edit_watchlist',
      new WatchlistDocumentError('Persisted watchlist is corrupt')
    )
    const variableResponse = buildCopilotServerToolErrorResponse(
      'edit_workflow_variable',
      new Error('Invalid edited workflow variables: Missing removedVariableIds.')
    )

    expect(response).toEqual({
      status: 500,
      body: {
        code: 'server_tool_execution_failed',
        error: 'Server tool execution failed',
        retryable: false,
      },
    })
    expect(response.body.error).not.toContain('corrupt')
    expect(variableResponse.status).toBe(422)
    expect(variableResponse.body.error).toContain('removedVariableIds')
  })

  // These construct the real error classes rather than stand-ins with a matching
  // `name`, because `name` is exactly what the mapping keys off: importing the
  // classes back into the source module would close an import cycle, so this is
  // the only place a rename can be caught.
  it('reports an unreachable realtime service as a retryable outage', () => {
    const response = buildCopilotServerToolErrorResponse(
      'create_workflow',
      new WorkflowRealtimeRequiredError(new Error('fetch failed'))
    )

    expect(response).toEqual({
      status: 503,
      body: expect.objectContaining({
        code: 'realtime_orchestration_unavailable',
        retryable: true,
      }),
    })
    // The cause has to survive: a bare "Server tool execution failed" is what
    // made this indistinguishable from a quota or permission problem.
    expect(response.body.error).toContain('fetch failed')
    expect(response.body.hint).toContain('INTERNAL_SOCKET_URL')
  })

  it('maps saved-entity realtime failures onto the same outage payload', () => {
    const response = buildCopilotServerToolErrorResponse(
      'create_knowledge_base',
      new SavedEntityRealtimeRequiredError()
    )

    expect(response.status).toBe(503)
    expect(response.body.code).toBe('realtime_orchestration_unavailable')
    expect(response.body.retryable).toBe(true)
  })

  it('reports a rejected internal call as a non-retryable configuration fault', () => {
    const response = buildCopilotServerToolErrorResponse(
      'create_workflow',
      new SocketServerBridgeError(403, JSON.stringify({ error: 'invalid internal secret' }))
    )

    // A 4xx means the socket server answered and refused. Retrying never clears
    // a mismatched secret, so it must not be advertised as retryable.
    expect(response).toEqual({
      status: 403,
      body: expect.objectContaining({
        code: 'realtime_bridge_rejected',
        retryable: false,
      }),
    })
    expect(response.body.hint).toContain('INTERNAL_API_SECRET')
  })

  // The fault this covers is a reverse proxy answering `/internal/*` with the
  // app's own HTML shell: a 200 the bridge accepts and only `response.json()`
  // rejects. Reporting it as an outage sent operators to check a service that
  // was healthy the whole time.
  const HTML_SHELL = '<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/>'

  it('reports a non-JSON 2xx body as a misroute rather than an outage', () => {
    const response = buildCopilotServerToolErrorResponse(
      'create_workflow',
      new SocketServerNonJsonResponseError(200, 'text/html; charset=utf-8', HTML_SHELL)
    )

    expect(response).toEqual({
      status: 502,
      body: expect.objectContaining({
        code: 'realtime_bridge_misrouted',
        // Retrying a misroute gets the same HTML every time.
        retryable: false,
      }),
    })
    expect(response.body.hint).toContain('INTERNAL_SOCKET_URL')
    expect(response.body.hint).toContain('NEXT_PUBLIC_SOCKET_URL')
  })

  it('keeps the status, content type and body in the reported message', () => {
    const response = buildCopilotServerToolErrorResponse(
      'create_workflow',
      new SocketServerNonJsonResponseError(200, 'text/html; charset=utf-8', HTML_SHELL)
    )

    // Each of these was absent from the bare SyntaxError this replaces, and each
    // was needed to tell a misroute apart from a realtime outage.
    expect(response.body.error).toContain('200')
    expect(response.body.error).toContain('text/html')
    expect(response.body.error).toContain('<!DOCTYPE html>')
    expect(response.body.error).toContain('reached the Next.js app')
  })

  it('classifies the misroute through the wrapper the workflow tools actually throw', () => {
    // create_workflow surfaces the bridge failure wrapped, and the wrapper keeps
    // only the message — so this passes solely because the cause is preserved.
    const response = buildCopilotServerToolErrorResponse(
      'create_workflow',
      new WorkflowRealtimeRequiredError(
        new SocketServerNonJsonResponseError(200, 'text/html', HTML_SHELL)
      )
    )

    expect(response.status).toBe(502)
    expect(response.body.code).toBe('realtime_bridge_misrouted')
  })

  it('still reports a genuinely unreachable service as a retryable outage', () => {
    // The misroute branch must not swallow the case it was carved out of.
    const response = buildCopilotServerToolErrorResponse(
      'create_workflow',
      new WorkflowRealtimeRequiredError(new Error('fetch failed'))
    )

    expect(response.status).toBe(503)
    expect(response.body.code).toBe('realtime_orchestration_unavailable')
    expect(response.body.retryable).toBe(true)
  })

  it('returns a structured 422 payload for tool argument schema failures', () => {
    const response = buildCopilotServerToolErrorResponse(
      'make_api_request',
      // Zod 4 issue shapes: `invalid_type` dropped `received`, and
      // `invalid_enum_value` became `invalid_value` carrying `values`.
      new z.ZodError([
        {
          code: 'invalid_type',
          expected: 'string',
          input: undefined,
          path: ['url'],
          message: 'Required',
        },
        {
          code: 'invalid_value',
          values: ['GET', 'POST', 'PUT'],
          input: 'get',
          path: ['method'],
          message: "Invalid enum value. Expected 'GET' | 'POST' | 'PUT', received 'get'",
        },
      ])
    )

    expect(response).toEqual({
      status: 422,
      body: expect.objectContaining({
        code: 'invalid_tool_payload',
        retryable: true,
      }),
    })
    expect(response.body.error).toContain('Invalid make_api_request payload')
    expect(response.body.error).toContain('url: Required')
    expect(response.body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'url', message: 'Required' }),
        expect.objectContaining({ path: 'method' }),
      ])
    )
  })

  it.each([
    [
      'dashboard layout',
      'edit_layout',
      createDashboardLayoutValidationError(
        'entityDocument.layout',
        'edit_layout entityDocument requires layout'
      ),
      'invalid_dashboard_layout_edit',
      'tg-dashboard-layout-structure-v3',
    ],
    [
      'widget config',
      'edit_widget',
      createWidgetConfigValidationError('colorPair.watchlistId', 'Unknown watchlist id'),
      'invalid_widget_config',
      'get_widgets_metadata',
    ],
  ])('returns a structured 422 payload for %s failures', (_, toolName, error, code, hint) => {
    const response = buildCopilotServerToolErrorResponse(toolName, error)

    expect(response).toEqual({
      status: 422,
      body: expect.objectContaining({ code, retryable: true, issues: error.issues }),
    })
    expect(response.body.hint).toContain(hint)
  })
})
