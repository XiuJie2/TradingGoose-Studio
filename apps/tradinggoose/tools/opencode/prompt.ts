import type { OpenCodePromptParams, OpenCodePromptResponse } from '@/tools/opencode/types'
import type { ToolConfig } from '@/tools/types'

export const promptTool: ToolConfig<OpenCodePromptParams, OpenCodePromptResponse> = {
  id: 'opencode_prompt',
  name: 'OpenCode Prompt',
  description: 'Run a prompt against a self-hosted OpenCode agent and return its reply.',
  version: '1.0',

  params: {
    prompt: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The instruction to send to the OpenCode agent',
    },
    agent: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Agent name, e.g. plan, build, general. Defaults to the configured agent.',
    },
    sessionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Existing OpenCode session to continue. Omit to start a fresh one.',
    },
    directory: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Directory on the OpenCode host the new session should work in',
    },
  },

  request: {
    url: '/api/tools/opencode/prompt',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      prompt: params.prompt,
      agent: params.agent,
      sessionId: params.sessionId,
      directory: params.directory,
    }),
  },

  transformResponse: async (response): Promise<OpenCodePromptResponse> => {
    const result = await response.json()
    return { success: true, output: result.data }
  },

  outputs: {
    content: { type: 'string', description: "The agent's reply" },
    sessionId: {
      type: 'string',
      description: 'Session the reply came from; pass it to a later block to continue the thread',
    },
    agent: { type: 'string', description: 'Agent that answered' },
    providerId: { type: 'string', description: 'Provider OpenCode routed to', optional: true },
    modelId: { type: 'string', description: 'Model OpenCode used', optional: true },
  },
}
