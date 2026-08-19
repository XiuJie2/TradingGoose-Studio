import { OpenCodeIcon } from '@/components/icons/icons'
import { OPENCODE_DEFAULT_AGENT } from '@/lib/opencode/constants'
import type { BlockConfig } from '@/blocks/types'
import type { OpenCodePromptResponse } from '@/tools/opencode/types'

export const OpenCodeBlock: BlockConfig<OpenCodePromptResponse> = {
  type: 'opencode',
  name: 'OpenCode',
  description: 'Run a prompt on a self-hosted OpenCode agent',
  longDescription:
    'Send a prompt to an OpenCode agent server and use its reply in the workflow. Unlike a plain ' +
    'chat model, an OpenCode agent has tools — it can read files, fetch pages and run commands on ' +
    'its host — so it is suited to research and analysis that needs to go and get things. ' +
    'The server address and credentials are configured once in Admin > Services, not per block.',
  docsLink: 'https://opencode.ai/docs/server/',
  category: 'tools',
  bgColor: '#111827',
  icon: OpenCodeIcon,
  subBlocks: [
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      layout: 'full',
      placeholder: 'What should the agent do?',
      required: true,
    },
    {
      id: 'agent',
      title: 'Agent',
      type: 'dropdown',
      layout: 'half',
      placeholder: OPENCODE_DEFAULT_AGENT,
      enableSearch: true,
      // Agent names are install-specific — a server can define any number of
      // them — so the options come from the configured server's own `GET /agent`
      // rather than a hardcoded list that would be wrong on every deployment but
      // the one it was written against. Leaving this empty uses the default agent
      // set in Admin > Services.
      fetchOptions: async () => {
        const response = await fetch('/api/tools/opencode/agents')
        const payload = await response.json().catch(() => null)

        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error ?? 'Could not list agents on the OpenCode server')
        }

        return (payload.agents as Array<{ name: string }>).map((agent) => ({
          id: agent.name,
          label: agent.name,
        }))
      },
    },
    {
      id: 'sessionId',
      title: 'Session ID',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Leave empty to start a new session',
    },
    {
      id: 'directory',
      title: 'Working Directory',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Path on the OpenCode host, e.g. /home/user/project',
    },
  ],
  tools: {
    access: ['opencode_prompt'],
    config: {
      tool: () => 'opencode_prompt',
      params: (params) => ({
        prompt: params.prompt,
        agent: params.agent || undefined,
        sessionId: params.sessionId || undefined,
        directory: params.directory || undefined,
      }),
    },
  },
  inputs: {
    prompt: { type: 'string', description: 'Instruction for the agent' },
    agent: { type: 'string', description: 'Agent name on the OpenCode server' },
    sessionId: { type: 'string', description: 'Existing session to continue' },
    directory: { type: 'string', description: 'Directory the session works in' },
  },
  outputs: {
    content: { type: 'string', description: "The agent's reply" },
    sessionId: { type: 'string', description: 'Session the reply came from' },
    agent: { type: 'string', description: 'Agent that answered' },
    providerId: { type: 'string', description: 'Provider OpenCode routed to' },
    modelId: { type: 'string', description: 'Model OpenCode used' },
  },
}
