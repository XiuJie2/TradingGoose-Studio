import { task } from '@trigger.dev/sdk'
import { env } from '@/lib/env'
import { executeDocumentProcessingJob } from './knowledge-processing-runner'

export {
  type DocumentProcessingPayload,
  dispatchQueuedDocumentProcessingJob,
  failQueuedDocumentProcessingJob,
  isDocumentProcessingPayload,
} from './knowledge-processing-runner'

const envNumber = (value: unknown, fallback: number, min = 1) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback
}

export const processDocument = task({
  id: 'knowledge-process-document',
  maxDuration: envNumber(env.KB_CONFIG_MAX_DURATION, 600),
  machine: 'large-1x',
  retry: {
    maxAttempts: envNumber(env.KB_CONFIG_MAX_ATTEMPTS, 3),
    factor: envNumber(env.KB_CONFIG_RETRY_FACTOR, 2),
    minTimeoutInMs: envNumber(env.KB_CONFIG_MIN_TIMEOUT, 1000),
    maxTimeoutInMs: envNumber(env.KB_CONFIG_MAX_TIMEOUT, 10000),
  },
  queue: {
    concurrencyLimit: envNumber(env.KB_CONFIG_CONCURRENCY_LIMIT, 20),
    name: 'document-processing-queue',
  },
  run: executeDocumentProcessingJob,
})
