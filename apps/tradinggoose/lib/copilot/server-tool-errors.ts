import { z } from 'zod'
import { DashboardLayoutValidationError } from '@/widgets/layout-document'
import { WidgetConfigValidationError } from '@/widgets/widget-mutations'

// Declared as a type alias rather than an interface so it keeps an implicit
// index signature: the MCP SDK types `structuredContent` as
// `{ [x: string]: unknown }`, which interfaces are not assignable to.
type CopilotServerToolErrorPayload = {
  error: string
  code: string
  hint?: string
  retryable?: boolean
  issues?: Array<{
    path: string
    message: string
  }>
}

interface CopilotServerToolErrorResponse {
  status: number
  body: CopilotServerToolErrorPayload
}

const GENERIC_SERVER_TOOL_ERROR = 'Server tool execution failed'

export class StructuredServerToolError extends Error {
  public readonly status: number
  public readonly code: string
  public readonly hint?: string
  public readonly retryable?: boolean
  public readonly issues?: Array<{
    path: string
    message: string
  }>

  constructor(input: CopilotServerToolErrorResponse) {
    super(input.body.error)
    this.name = 'StructuredServerToolError'
    this.status = input.status
    this.code = input.body.code
    this.hint = input.body.hint
    this.retryable = input.body.retryable
    this.issues = input.body.issues
  }
}

function formatZodIssuePath(issue: z.ZodIssue): string {
  if (!issue.path || issue.path.length === 0) {
    return '$'
  }

  // Zod 4 widens path segments to PropertyKey, so a segment can be a symbol
  // that would throw on implicit string conversion.
  return issue.path
    .map((segment, index) => {
      if (typeof segment === 'number') return `[${segment}]`
      const key = String(segment)
      return index === 0 ? key : `.${key}`
    })
    .join('')
}

function buildInvalidToolPayloadError(
  toolName: string | undefined,
  error: z.ZodError
): CopilotServerToolErrorResponse {
  const formattedIssues = error.issues.map((issue) => ({
    path: formatZodIssuePath(issue),
    message: issue.message,
  }))
  const issueSummary = formattedIssues
    .slice(0, 3)
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join('; ')
  const displayName = toolName?.trim() || 'tool'

  return {
    status: 422,
    body: {
      code: 'invalid_tool_payload',
      error: `Invalid ${displayName} payload: ${issueSummary || 'Payload did not match the tool schema.'}`,
      hint: 'Match the payload exactly to the active tool manifest. Use only allowed top-level properties, include required fields, and respect enum/value constraints.',
      retryable: true,
      issues: formattedIssues,
    },
  }
}

function buildEditWorkflowError(message: string): CopilotServerToolErrorResponse | null {
  const isGraphDocumentError =
    message.startsWith('Workflow graph Mermaid ') ||
    /^New workflow block ".+" is missing a type label\.$/.test(message) ||
    /^Unknown workflow block type ".+" for new block ".+"\.$/.test(message) ||
    message === 'entityDocument is required'

  if (isGraphDocumentError) {
    return {
      status: 422,
      body: {
        code: 'invalid_workflow_graph_document',
        error: message,
        hint: 'Send a complete minimal Mermaid graph starting with `flowchart TD` or `flowchart LR`. Do not include TG_* metadata or block internals. Every new block needs `id:` and canonical `type:` labels from `get_available_blocks` or `get_blocks_metadata`.',
        retryable: true,
        issues: [{ path: 'entityDocument', message }],
      },
    }
  }

  if (message.startsWith('Invalid container edge:')) {
    return {
      status: 422,
      body: {
        code: 'invalid_workflow_document_container_edge',
        error: message,
        hint: 'For loop and parallel containers, connect outer edges to the container node and internal edges to the generated start/end nodes.',
        retryable: true,
        issues: [{ path: 'entityDocument.edges', message }],
      },
    }
  }

  if (message.startsWith('Invalid edited workflow:')) {
    const details = message.replace(/^Invalid edited workflow:\s*/, '').trim()
    const detailIssues = details
      .split(/;\s+/)
      .filter(Boolean)
      .map((issue) => {
        const trimmedIssue = issue.trim().replace(/\.$/, '')
        const embeddedPathMatch = trimmedIssue.match(
          /^Document contract is inconsistent: invalid block sub-block values for ([^ ]+) \((.+)\)$/
        )

        return {
          path: embeddedPathMatch ? `entityDocument.${embeddedPathMatch[1]}` : 'entityDocument',
          message: embeddedPathMatch ? embeddedPathMatch[2] : trimmedIssue,
        }
      })

    const hint = details.includes('non-canonical sub-block')
      ? 'Use only the canonical sub-block ids from `get_blocks_metadata` for that block type. Keep the existing canonical ids and remove invented keys.'
      : details.includes('removedBlockIds')
        ? 'Keep every existing block id in the Mermaid graph unless the user explicitly asked to remove it; list intentional removals in `removedBlockIds`.'
        : details.includes('immutable identities')
          ? 'Keep the existing block id/type pair unchanged. `edit_workflow` rewrites topology only; it cannot replace an existing block or change its type.'
          : details.includes('unknown block type')
            ? 'Use block types exactly as returned by `get_available_blocks` or `get_blocks_metadata`.'
            : details.includes('Edge references non-existent')
              ? 'Every edge source and target must match a block id in the same document.'
              : 'Return a complete workflow graph that validates as workflow state. Preserve block ids and valid edge references.'

    return {
      status: 422,
      body: {
        code: 'invalid_workflow_state',
        error: message,
        hint,
        retryable: true,
        ...(detailIssues.length > 0 ? { issues: detailIssues } : {}),
      },
    }
  }

  return null
}

/**
 * Errors raised when the Yjs realtime bridge could not complete a write.
 *
 * These reach here as plain `Error` subclasses, so without this branch they fall
 * through to the generic 500 — which is the worst possible outcome for them.
 * `create_workflow` inserts its row, calls the socket server, and rolls the row
 * back when that call fails, so the caller sees a mutation that silently did
 * nothing and a `retryable: false` payload telling it not to try again. The
 * cause is an operator-fixable infrastructure fault, so it is named here.
 *
 * Matched by `name` rather than `instanceof` because every class that carries
 * one sits downstream of this module: `snapshot-bridge` and (via it)
 * `db-helpers` both import `StructuredServerToolError` from this file, so
 * importing them back would close an import cycle. The test builds the real
 * errors and asserts this mapping, so a rename fails there rather than silently
 * reverting these to the generic 500.
 */
const REALTIME_BRIDGE_ERROR_NAMES = new Set([
  'WorkflowRealtimeRequiredError',
  'SavedEntityRealtimeRequiredError',
  'SocketServerBridgeError',
])

function buildRealtimeBridgeError(
  message: string,
  status: unknown
): CopilotServerToolErrorResponse {
  // A 4xx from the socket server means it answered and refused — almost always a
  // mismatched internal secret. Retrying that forever never clears it, so it is
  // reported as a configuration fault rather than a transient outage.
  const rejectedStatus = typeof status === 'number' && status >= 400 && status < 500 ? status : null

  return {
    status: rejectedStatus ?? 503,
    body: {
      code: rejectedStatus ? 'realtime_bridge_rejected' : 'realtime_orchestration_unavailable',
      error: `Workflow realtime orchestration failed: ${message}`,
      hint: rejectedStatus
        ? 'The realtime service rejected the internal call. Check that INTERNAL_API_SECRET is identical in the app and realtime services, then retry.'
        : 'The realtime service did not complete the write, so the change was rolled back and nothing was saved. Check that the realtime service is running and reachable at INTERNAL_SOCKET_URL, then retry.',
      retryable: !rejectedStatus,
    },
  }
}

export function buildCopilotServerToolErrorResponse(
  toolName: string | undefined,
  error: unknown
): CopilotServerToolErrorResponse {
  if (error instanceof StructuredServerToolError) {
    return {
      status: error.status,
      body: {
        code: error.code,
        error: error.message,
        ...(typeof error.hint === 'string' ? { hint: error.hint } : {}),
        ...(typeof error.retryable === 'boolean' ? { retryable: error.retryable } : {}),
        ...(Array.isArray(error.issues) ? { issues: error.issues } : {}),
      },
    }
  }

  if (error instanceof z.ZodError) {
    return buildInvalidToolPayloadError(toolName, error)
  }

  if (error instanceof DashboardLayoutValidationError) {
    return {
      status: 422,
      body: {
        code: 'invalid_dashboard_layout_edit',
        error: error.message,
        hint: 'Send one complete tg-dashboard-layout-structure-v3 layout document. Retain existing panels by id, add or replace their widget with widget.key, add new panels with widget.key, and list intentionally omitted existing panels in removedPanelIds.',
        retryable: true,
        issues: error.issues,
      },
    }
  }

  if (error instanceof WidgetConfigValidationError) {
    return {
      status: 422,
      body: {
        code: 'invalid_widget_config',
        error: error.message,
        hint: 'Use get_widgets_metadata for editable params, pair colors, and linked color-pair fields. Use edit_layout with a key from get_available_widgets to add, replace, or remove widget bindings.',
        retryable: true,
        issues: error.issues,
      },
    }
  }

  const message = error instanceof Error ? error.message : 'Failed to execute server tool'
  if (toolName === 'edit_workflow') {
    const structuredError = buildEditWorkflowError(message)
    if (structuredError) {
      return structuredError
    }
  }
  if (
    toolName === 'edit_workflow_variable' &&
    /^(Invalid edited workflow variables:|Duplicate workflow variable|Unsupported workflow variable|Unsupported documentFormat ")/.test(
      message
    )
  ) {
    return {
      status: 422,
      body: {
        code: 'invalid_workflow_variable_document',
        error: message,
        retryable: true,
      },
    }
  }

  if (error instanceof Error && REALTIME_BRIDGE_ERROR_NAMES.has(error.name)) {
    return buildRealtimeBridgeError(message, (error as { status?: unknown }).status)
  }

  return {
    status: 500,
    body: {
      code: 'server_tool_execution_failed',
      error: GENERIC_SERVER_TOOL_ERROR,
      retryable: false,
    },
  }
}
