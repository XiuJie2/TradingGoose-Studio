import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { listOpenCodeAgents, OpenCodeError, resolveOpenCodeConnection } from '@/lib/opencode/client'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('OpenCodeAgentsAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Lists the agents the configured OpenCode server defines, for the block's
 * Agent dropdown.
 *
 * Like the prompt route, this runs server-side because the address and
 * credentials come from Admin > Services: resolving them touches the database
 * and decrypts a stored secret, neither of which may reach the browser.
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const connection = await resolveOpenCodeConnection()
    const agents = await listOpenCodeAgents(connection)

    logger.info(`[${requestId}] Listed OpenCode agents`, { count: agents.length })

    return NextResponse.json({ success: true, agents }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OpenCode request failed'
    logger.error(`[${requestId}] OpenCode agent listing failed`, { error: message })

    // The editor renders this message next to the dropdown, so an OpenCodeError
    // (unreachable host, wrong Base URL) has to survive; anything else is ours.
    return NextResponse.json(
      {
        success: false,
        error: error instanceof OpenCodeError ? message : 'OpenCode request failed',
      },
      { status: 502 }
    )
  }
}
