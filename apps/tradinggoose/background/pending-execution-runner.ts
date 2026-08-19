import {
  claimNextPendingExecution,
  completePendingExecution,
  type PendingExecutionClaim,
} from '@/lib/execution/pending-execution'
import { createLogger } from '@/lib/logs/console/logger'
import {
  dispatchQueuedDocumentProcessingJob,
  failQueuedDocumentProcessingJob,
} from './knowledge-processing'
import { executeMonitorJob, isMonitorExecutionPayload } from './monitor-execution'
import { executeScheduleJob, isScheduleExecutionPayload } from './schedule-execution'
import { executeWebhookJob, isWebhookExecutionPayload } from './webhook-execution'
import { executeWorkflowJob, isWorkflowExecutionPayload } from './workflow-execution'

/**
 * The queue drain itself, with no Trigger.dev involvement.
 *
 * A deployment that runs without Trigger.dev drains the queue in-process, so this
 * has to be importable without pulling in `@trigger.dev/sdk` — importing the task
 * wrappers in `./pending-execution-drain` would load the SDK and register tasks on
 * a runtime that has no worker to run them.
 */

const logger = createLogger('PendingExecutionRunner')

export type PendingExecutionDrainPayload = {
  billingScopeId: string
}

async function dispatchPendingExecution(row: PendingExecutionClaim): Promise<boolean> {
  switch (row.executionType) {
    case 'workflow': {
      if (!isWorkflowExecutionPayload(row.payload)) {
        throw new Error('Invalid workflow pending payload')
      }

      await executeWorkflowJob({
        ...row.payload,
        executionId: row.id,
      })
      break
    }

    case 'webhook': {
      if (!isWebhookExecutionPayload(row.payload)) {
        throw new Error('Invalid webhook pending payload')
      }

      await executeWebhookJob({
        ...row.payload,
        executionId: row.id,
      })
      break
    }

    case 'schedule': {
      if (!isScheduleExecutionPayload(row.payload)) {
        throw new Error('Invalid schedule pending payload')
      }

      await executeScheduleJob({
        ...row.payload,
        executionId: row.id,
      })
      break
    }

    case 'monitor': {
      if (!isMonitorExecutionPayload(row.payload)) {
        throw new Error('Invalid monitor pending payload')
      }

      await executeMonitorJob({
        ...row.payload,
        executionId: row.id,
      })
      break
    }

    case 'document': {
      try {
        await dispatchQueuedDocumentProcessingJob(row.payload)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Pending execution failed'
        await failQueuedDocumentProcessingJob(row.payload, errorMessage)
        await completePendingExecution({
          pendingExecutionId: row.id,
        })
        return false
      }
      break
    }

    default:
      throw new Error(`Unsupported pending execution type: ${row.executionType}`)
  }

  await completePendingExecution({
    pendingExecutionId: row.id,
  })
  return true
}

export async function drainPendingExecutionsForBillingScope(payload: PendingExecutionDrainPayload) {
  let claimedAny = false
  let failedAny = false
  let lastPendingExecutionId: string | undefined

  // Keep the worker responsible for the current scope until the queue is empty or capacity blocked.
  while (true) {
    const claim = await claimNextPendingExecution(payload.billingScopeId)

    if (claim.status === 'empty') {
      if (!claimedAny) {
        return { success: true, skipped: 'empty' as const }
      }
      return {
        success: !failedAny,
        pendingExecutionId: lastPendingExecutionId,
      }
    }

    if (claim.status === 'capacity_blocked') {
      return {
        success: !failedAny,
        pendingExecutionId: claim.pendingExecutionId,
      }
    }

    const row = claim.row
    claimedAny = true
    lastPendingExecutionId = row.id

    try {
      const succeeded = await dispatchPendingExecution(row)
      failedAny ||= !succeeded
    } catch (error) {
      failedAny = true

      logger.error('Pending execution failed', {
        pendingExecutionId: row.id,
        executionType: row.executionType,
        workflowId: row.workflowId,
        error,
      })
    }
  }
}
