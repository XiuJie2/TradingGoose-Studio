import {
  markDocumentProcessingFailed,
  processDocumentAsync,
} from '@/lib/knowledge/documents/service'
import { createLogger } from '@/lib/logs/console/logger'
import { getTriggerExecutionState } from '@/lib/trigger/settings'

/**
 * Document processing with no Trigger.dev involvement.
 *
 * A deployment without Trigger.dev drains its own queue in-process, so this has
 * to be importable without `@trigger.dev/sdk`: the task wrapper in
 * `./knowledge-processing` registers a task on a runtime that has no worker.
 */

const logger = createLogger('KnowledgeProcessing')

export type DocumentProcessingPayload = {
  knowledgeBaseId: string
  documentId: string
  userId: string
  workspaceId: string
  docData: {
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
  }
  processingOptions: {
    chunkSize: number
    minCharactersPerChunk: number
    chunkOverlap: number
  }
  requestId: string
}

export function isDocumentProcessingPayload(value: unknown): value is DocumentProcessingPayload {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.knowledgeBaseId === 'string' &&
    typeof candidate.documentId === 'string' &&
    typeof candidate.userId === 'string' &&
    typeof candidate.workspaceId === 'string' &&
    typeof candidate.requestId === 'string'
  )
}

export async function executeDocumentProcessingJob(payload: DocumentProcessingPayload) {
  const { knowledgeBaseId, documentId, docData, processingOptions, requestId } = payload

  logger.info(`[${requestId}] Starting document pending execution: ${docData.filename}`)

  try {
    await processDocumentAsync(knowledgeBaseId, documentId, docData, processingOptions)

    logger.info(
      `[${requestId}] Successfully completed document pending execution: ${docData.filename}`
    )
  } catch (error) {
    logger.error(`[${requestId}] Failed document pending execution: ${docData.filename}`, error)
    throw error
  }
}

export async function dispatchQueuedDocumentProcessingJob(payload: unknown) {
  if (!isDocumentProcessingPayload(payload)) {
    throw new Error('Invalid document pending payload')
  }

  const { executionEnabled } = await getTriggerExecutionState()

  // `triggerAndWait` throws "can only be used from inside a task.run()" outside
  // a Trigger.dev worker, which is exactly where a self-hosted drain runs it.
  // The document then lands as `failed` with that message and no chunks, so the
  // knowledge base reports docCount > 0 alongside tokenCount 0.
  if (!executionEnabled) {
    await executeDocumentProcessingJob(payload)
    return
  }

  const { processDocument } = await import('./knowledge-processing')
  await processDocument.triggerAndWait(payload).unwrap()
}

export async function failQueuedDocumentProcessingJob(payload: unknown, errorMessage: string) {
  if (!isDocumentProcessingPayload(payload)) {
    return
  }

  await markDocumentProcessingFailed(payload.documentId, errorMessage)
}
