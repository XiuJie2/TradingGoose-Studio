'use client'

import { useEffect, useState } from 'react'
import { Brain, BrainCircuit, Zap } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  TooltipProvider,
} from '@/components/ui'
import {
  COPILOT_RUNTIME_MODEL_OPTIONS,
  type CopilotRuntimeModel,
  DEFAULT_COPILOT_RUNTIME_MODEL,
} from '@/lib/copilot/runtime-models'
import { cn } from '@/lib/utils'
import { useCopilotMessages } from '@/i18n/workspace-widget-hooks'
import { useCopilotStore } from '@/stores/copilot/store'
import { BRAIN_CIRCUIT_MODELS, BRAIN_MODELS, FAST_MODELS } from '../constants'

interface ModelSelectorProps {
  isNearTop: boolean
  panelWidth: number
}

interface CopilotModelGroup {
  provider: string
  label: string
  models: string[]
}

const getModelOptionIcon = (modelValue: CopilotRuntimeModel) => {
  if (BRAIN_CIRCUIT_MODELS.includes(modelValue)) {
    return <BrainCircuit className='h-3 w-3 text-muted-foreground' />
  }

  if (BRAIN_MODELS.includes(modelValue)) {
    return <Brain className='h-3 w-3 text-muted-foreground' />
  }

  if (FAST_MODELS.includes(modelValue)) {
    return <Zap className='h-3 w-3 text-muted-foreground' />
  }

  return <div className='h-3 w-3' />
}

/**
 * Falls back to the hosted model set so the picker is never empty while the
 * request is in flight or if the deployment cannot list its providers.
 */
const FALLBACK_GROUPS: CopilotModelGroup[] = [
  {
    provider: 'anthropic',
    label: 'Anthropic',
    models: COPILOT_RUNTIME_MODEL_OPTIONS.filter((option) =>
      option.value.startsWith('claude-')
    ).map((option) => option.value),
  },
  {
    provider: 'openai',
    label: 'OpenAI',
    models: COPILOT_RUNTIME_MODEL_OPTIONS.filter((option) => option.value.startsWith('gpt-')).map(
      (option) => option.value
    ),
  },
]

export function ModelSelector({ isNearTop, panelWidth }: ModelSelectorProps) {
  const modelCopy = useCopilotMessages().model
  const { agentPrefetch, selectedModel, setAgentPrefetch, setSelectedModel } = useCopilotStore()
  const [groups, setGroups] = useState<CopilotModelGroup[]>(FALLBACK_GROUPS)

  useEffect(() => {
    let cancelled = false

    const loadModels = async () => {
      try {
        const response = await fetch('/api/copilot/models')
        if (!response.ok) return

        const data = (await response.json()) as {
          groups?: CopilotModelGroup[]
          defaultModel?: string | null
        }
        const nextGroups = (data.groups ?? []).filter((group) => group.models.length > 0)
        if (cancelled || nextGroups.length === 0) return

        setGroups(nextGroups)

        // The stored selection can be a model this deployment does not serve —
        // a hosted default on a local runtime, or a provider whose key was
        // removed. Move it onto something that actually works.
        const available = new Set(nextGroups.flatMap((group) => group.models))
        if (!available.has(selectedModel)) {
          setSelectedModel(data.defaultModel || nextGroups[0].models[0])
        }
      } catch {
        // Keep the fallback groups; the picker stays usable.
      }
    }

    void loadModels()
    return () => {
      cancelled = true
    }
  }, [selectedModel, setSelectedModel])

  const collapsedModeLabel = selectedModel || DEFAULT_COPILOT_RUNTIME_MODEL

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant='outline'
            size='sm'
            className='flex h-6 bg-background hover:bg-muted/30 items-center gap-1.5 rounded-sm border px-2 py-1 font-medium text-xs focus-visible:ring-0 focus-visible:ring-offset-0'
            title={modelCopy.choose}
          />
        }
      >
        {getModelOptionIcon(selectedModel)}
        <span className={cn(panelWidth < 360 ? 'max-w-[72px] truncate' : '')}>
          {collapsedModeLabel}
          {agentPrefetch && !FAST_MODELS.includes(selectedModel) && (
            <span className='ml-1 font-semibold'>{modelCopy.lite}</span>
          )}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={isNearTop ? 'bottom' : 'top'} className='max-h-[400px] p-0'>
        <TooltipProvider delay={100} timeout={0}>
          <div className='w-[280px]'>
            <div className='max-h-[280px] overflow-y-auto p-2'>
              <div>
                <div className='mb-1'>
                  <span className='font-medium text-xs'>{modelCopy.label}</span>
                </div>
                <div className='space-y-2'>
                  {groups.map((group) => (
                    <div key={group.provider}>
                      <div className='px-2 py-1 font-medium text-[10px] text-muted-foreground uppercase'>
                        {group.label}
                      </div>
                      <div className='space-y-0.5'>
                        {group.models.map((model) => (
                          <DropdownMenuItem
                            key={model}
                            onClick={() => {
                              setSelectedModel(model)
                              if (FAST_MODELS.includes(model) && agentPrefetch) {
                                setAgentPrefetch(false)
                              }
                            }}
                            className={cn(
                              'flex h-7 items-center gap-1.5 px-2 py-1 text-left text-xs',
                              selectedModel === model ? 'bg-muted/50' : ''
                            )}
                          >
                            {getModelOptionIcon(model)}
                            <span className='truncate'>{model}</span>
                          </DropdownMenuItem>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </TooltipProvider>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
