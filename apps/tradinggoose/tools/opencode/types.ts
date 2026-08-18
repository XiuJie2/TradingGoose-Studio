import type { ToolResponse } from '@/tools/types'

export interface OpenCodePromptParams {
  prompt: string
  agent?: string
  sessionId?: string
  directory?: string
}

export interface OpenCodePromptResponse extends ToolResponse {
  output: {
    content: string
    sessionId: string
    agent: string
    providerId: string | null
    modelId: string | null
  }
}
