import { db } from '@tradinggoose/db'
import { pendingExecution } from '@tradinggoose/db/schema'
import { schedules, task } from '@trigger.dev/sdk'
import { PENDING_EXECUTION_DRAIN_TASK_ID } from '@/lib/execution/pending-execution'
import { wakePendingExecutionDrain } from '@/lib/execution/pending-execution-drain-wake'
import {
  drainPendingExecutionsForBillingScope,
  type PendingExecutionDrainPayload,
} from './pending-execution-runner'

export {
  drainPendingExecutionsForBillingScope,
  type PendingExecutionDrainPayload,
} from './pending-execution-runner'

export const pendingExecutionDrain = task({
  id: PENDING_EXECUTION_DRAIN_TASK_ID,
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: PendingExecutionDrainPayload) => {
    return drainPendingExecutionsForBillingScope(payload)
  },
})

export async function recoverPendingExecutionDrains() {
  const scopes = await db
    .selectDistinct({ billingScopeId: pendingExecution.billingScopeId })
    .from(pendingExecution)

  await Promise.all(
    scopes.map(({ billingScopeId }) => wakePendingExecutionDrain({ billingScopeId }))
  )

  return { recoveredScopeCount: scopes.length }
}

export const pendingExecutionRecoverySweep = schedules.task({
  id: 'pending-execution-recovery-sweep',
  cron: '*/5 * * * *',
  run: recoverPendingExecutionDrains,
})
