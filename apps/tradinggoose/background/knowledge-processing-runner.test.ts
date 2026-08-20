/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  processDocumentAsyncMock,
  markDocumentProcessingFailedMock,
  getTriggerExecutionStateMock,
  triggerAndWaitMock,
} = vi.hoisted(() => ({
  processDocumentAsyncMock: vi.fn(),
  markDocumentProcessingFailedMock: vi.fn(),
  getTriggerExecutionStateMock: vi.fn(),
  triggerAndWaitMock: vi.fn(),
}))

vi.mock('@/lib/knowledge/documents/service', () => ({
  processDocumentAsync: processDocumentAsyncMock,
  markDocumentProcessingFailed: markDocumentProcessingFailedMock,
}))

vi.mock('@/lib/trigger/settings', () => ({
  getTriggerExecutionState: getTriggerExecutionStateMock,
}))

vi.mock('@/background/knowledge-processing', () => ({
  processDocument: {
    triggerAndWait: (payload: unknown) => ({
      unwrap: () => triggerAndWaitMock(payload),
    }),
  },
}))

import {
  dispatchQueuedDocumentProcessingJob,
  failQueuedDocumentProcessingJob,
} from './knowledge-processing-runner'

const payload = {
  knowledgeBaseId: 'kb-1',
  documentId: 'doc-1',
  userId: 'user-1',
  workspaceId: 'workspace-1',
  requestId: 'req-1',
  docData: {
    filename: 'Watchlist 研究筆記.txt',
    fileUrl: 'https://files.test/notes.txt',
    fileSize: 1809,
    mimeType: 'text/plain',
  },
  processingOptions: { chunkSize: 1024, minCharactersPerChunk: 1, chunkOverlap: 200 },
}

describe('dispatchQueuedDocumentProcessingJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    processDocumentAsyncMock.mockResolvedValue(undefined)
    triggerAndWaitMock.mockResolvedValue(undefined)
  })

  it('processes in-process when Trigger.dev is not enabled', async () => {
    getTriggerExecutionStateMock.mockResolvedValue({
      executionEnabled: false,
      triggerDevEnabled: false,
      configurationReady: false,
    })

    // Calling triggerAndWait here throws "can only be used from inside a
    // task.run()", which is what left uploaded documents as `failed` with zero
    // chunks on a self-hosted deployment.
    await dispatchQueuedDocumentProcessingJob(payload)

    expect(processDocumentAsyncMock).toHaveBeenCalledWith(
      'kb-1',
      'doc-1',
      payload.docData,
      payload.processingOptions
    )
    expect(triggerAndWaitMock).not.toHaveBeenCalled()
  })

  it('hands off to Trigger.dev when it is enabled', async () => {
    getTriggerExecutionStateMock.mockResolvedValue({
      executionEnabled: true,
      triggerDevEnabled: true,
      configurationReady: true,
    })

    await dispatchQueuedDocumentProcessingJob(payload)

    expect(triggerAndWaitMock).toHaveBeenCalledWith(payload)
    expect(processDocumentAsyncMock).not.toHaveBeenCalled()
  })

  it('rejects a payload that is not a document job', async () => {
    getTriggerExecutionStateMock.mockResolvedValue({
      executionEnabled: false,
      triggerDevEnabled: false,
      configurationReady: false,
    })

    await expect(dispatchQueuedDocumentProcessingJob({ documentId: 'doc-1' })).rejects.toThrow(
      'Invalid document pending payload'
    )
    expect(processDocumentAsyncMock).not.toHaveBeenCalled()
  })

  it('marks the document failed when processing throws', async () => {
    getTriggerExecutionStateMock.mockResolvedValue({
      executionEnabled: false,
      triggerDevEnabled: false,
      configurationReady: false,
    })
    processDocumentAsyncMock.mockRejectedValue(new Error('embedding provider unavailable'))

    await expect(dispatchQueuedDocumentProcessingJob(payload)).rejects.toThrow(
      'embedding provider unavailable'
    )

    // The caller records the failure; the document must not sit at `pending`
    // forever, which reads as "still working" rather than "broken".
    await failQueuedDocumentProcessingJob(payload, 'embedding provider unavailable')
    expect(markDocumentProcessingFailedMock).toHaveBeenCalledWith(
      'doc-1',
      'embedding provider unavailable'
    )
  })
})
