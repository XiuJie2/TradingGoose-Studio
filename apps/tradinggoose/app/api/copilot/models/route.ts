import { NextResponse } from 'next/server'
import {
  authenticateCopilotRequestSessionOnly,
  createInternalServerErrorResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/auth'
import {
  type CopilotModelGroup,
  listLocalCopilotModelGroups,
} from '@/lib/copilot/local-runtime/model-catalog'
import { HOSTED_COPILOT_RUNTIME_MODELS } from '@/lib/copilot/runtime-models'
import { createLogger } from '@/lib/logs/console/logger'
import { isLocalCopilotMode } from '@/app/api/copilot/proxy'

const logger = createLogger('CopilotModelsAPI')

export const dynamic = 'force-dynamic'

const HOSTED_GROUPS: CopilotModelGroup[] = [
  {
    provider: 'anthropic',
    label: 'Anthropic',
    models: HOSTED_COPILOT_RUNTIME_MODELS.filter((model) => model.startsWith('claude-')),
  },
  {
    provider: 'openai',
    label: 'OpenAI',
    models: HOSTED_COPILOT_RUNTIME_MODELS.filter((model) => model.startsWith('gpt-')),
  },
]

/**
 * GET /api/copilot/models
 * The models the Copilot picker may offer. In local mode this is derived from
 * whichever providers have keys in Admin > Services; in hosted mode it is the
 * fixed set the managed service supports.
 */
export async function GET() {
  try {
    const { isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated) {
      return createUnauthorizedResponse()
    }

    const local = await isLocalCopilotMode()
    const groups = local ? await listLocalCopilotModelGroups() : HOSTED_GROUPS

    return NextResponse.json({
      mode: local ? 'local' : 'hosted',
      groups,
      defaultModel: groups[0]?.models[0] ?? null,
    })
  } catch (error) {
    logger.error('Failed to list copilot models', error)
    return createInternalServerErrorResponse('Failed to list copilot models')
  }
}
