import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import {
  createOpenCodeSession,
  OpenCodeError,
  promptOpenCodeSession,
  resolveOpenCodeConnection,
} from '@/lib/opencode/client'
import { resolveOpenCodeServiceConfig } from '@/lib/system-services/runtime'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('OpenCodePromptAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Runs one OpenCode prompt on behalf of a block.
 *
 * This lives server-side rather than in the tool's own `directExecution`
 * because the OpenCode address and credentials come from Admin > Services:
 * resolving them touches the database and decrypts a stored secret, neither of
 * which may reach the browser bundle.
 */
export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    let body: { prompt?: unknown; agent?: unknown; sessionId?: unknown; directory?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON in request body' },
        { status: 400 }
      )
    }

    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    if (!prompt) {
      return NextResponse.json(
        { success: false, error: 'The prompt parameter is required' },
        { status: 400 }
      )
    }

    const connection = await resolveOpenCodeConnection()
    const agent =
      (typeof body.agent === 'string' && body.agent.trim()) ||
      (await resolveOpenCodeServiceConfig()).defaultAgent

    // Reusing a session is what makes a multi-block conversation possible; a
    // fresh one per run is the default so unrelated executions cannot read
    // each other's context.
    const sessionId =
      typeof body.sessionId === 'string' && body.sessionId.trim()
        ? body.sessionId.trim()
        : await createOpenCodeSession(
            connection,
            typeof body.directory === 'string' ? body.directory : undefined
          )

    const result = await promptOpenCodeSession(connection, { sessionId, prompt, agent })

    logger.info(`[${requestId}] OpenCode prompt completed`, {
      agent,
      model: result.modelId,
      contentLength: result.content.length,
    })

    return NextResponse.json({ success: true, data: result }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OpenCode request failed'
    logger.error(`[${requestId}] OpenCode prompt failed`, { error: message })

    // An OpenCodeError is already a description of what went wrong on the
    // OpenCode side; anything else is ours and should not be echoed verbatim.
    return NextResponse.json(
      {
        success: false,
        error: error instanceof OpenCodeError ? message : 'OpenCode request failed',
      },
      { status: 502 }
    )
  }
}
