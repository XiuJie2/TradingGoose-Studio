'use client'

import type { CopilotRuntimeModel } from '@/lib/copilot/runtime-models'
import { COPILOT_WORKSPACE_ENTITY_MENTION_OPTIONS } from '../../workspace-entities'
import type { MentionOption, MentionSubmenu } from './types'

// Classification for the model picker, which is itself built from
// `/api/copilot/models` — these lists only decide presentation and one
// behaviour. BRAIN/BRAIN_CIRCUIT pick an icon; FAST also turns the lite
// prefetch off on selection, since it exists to speed up a slower model.
// MiniMax's `-highspeed` variants are the same weights tuned for latency at
// twice the price, which is exactly that case.
export const BRAIN_MODELS: readonly CopilotRuntimeModel[] = [
  'minimax/MiniMax-M2.7',
  'minimax/MiniMax-M2.5',
  'minimax/MiniMax-M2.1',
  'minimax/MiniMax-M2',
  'gpt-5.4',
  'claude-sonnet-4.6',
]
export const BRAIN_CIRCUIT_MODELS: readonly CopilotRuntimeModel[] = [
  'minimax/MiniMax-M3',
  'claude-opus-4.6',
]
export const FAST_MODELS: readonly CopilotRuntimeModel[] = [
  'minimax/MiniMax-M2.7-highspeed',
  'minimax/MiniMax-M2.5-highspeed',
  'minimax/MiniMax-M2.1-highspeed',
  'gpt-5.4-mini',
]
export const ANTHROPIC_MODELS: readonly CopilotRuntimeModel[] = [
  'claude-sonnet-4.6',
  'claude-opus-4.6',
]
export const OPENAI_MODELS: readonly CopilotRuntimeModel[] = ['gpt-5.4', 'gpt-5.4-mini']

export const MENTION_OPTIONS: readonly MentionOption[] = [
  'chats',
  ...COPILOT_WORKSPACE_ENTITY_MENTION_OPTIONS,
  'workflow_blocks',
  'blocks',
  'knowledge',
  'docs',
  'logs',
]

export const MENTION_SUBMENUS: readonly MentionSubmenu[] = MENTION_OPTIONS.filter(
  (option): option is MentionSubmenu => option !== 'docs'
)

export const MAX_TEXTAREA_HEIGHT = 120
export const MAX_MENTION_MENU_HEIGHT = 360
