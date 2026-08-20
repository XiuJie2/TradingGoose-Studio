import { afterEach, describe, expect, it, vi } from 'vitest'

const originalInternalSecret = process.env.INTERNAL_API_SECRET

afterEach(() => {
  if (originalInternalSecret === undefined) {
    delete process.env.INTERNAL_API_SECRET
  } else {
    process.env.INTERNAL_API_SECRET = originalInternalSecret
  }
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function callVerifyCronAuth(authHeader?: string) {
  const { verifyCronAuth } = await import('./internal')
  const headers = new Headers()
  if (authHeader !== undefined) {
    headers.set('authorization', authHeader)
  }

  return verifyCronAuth({ headers } as never, 'test endpoint')
}

describe('verifyCronAuth', () => {
  it('rejects every caller when CRON_SECRET is not configured', async () => {
    vi.stubEnv('CRON_SECRET', undefined)
    vi.resetModules()

    // The expected header used to be built by interpolation, so an unset secret
    // made `Bearer undefined` the valid credential for every cron endpoint.
    expect(await callVerifyCronAuth('Bearer undefined')).not.toBeNull()
    expect(await callVerifyCronAuth('Bearer ')).not.toBeNull()
    expect(await callVerifyCronAuth()).not.toBeNull()
  })

  it('rejects a blank CRON_SECRET the same way', async () => {
    vi.stubEnv('CRON_SECRET', '   ')
    vi.resetModules()

    expect(await callVerifyCronAuth('Bearer    ')).not.toBeNull()
    expect(await callVerifyCronAuth('Bearer undefined')).not.toBeNull()
  })

  it('accepts only the configured secret', async () => {
    vi.stubEnv('CRON_SECRET', 'super-secret-cron-value')
    vi.resetModules()

    expect(await callVerifyCronAuth('Bearer super-secret-cron-value')).toBeNull()
    expect(await callVerifyCronAuth('Bearer super-secret-cron-valu')).not.toBeNull()
    expect(await callVerifyCronAuth('Bearer undefined')).not.toBeNull()
    expect(await callVerifyCronAuth()).not.toBeNull()
  })
})

describe('internal auth tokens', () => {
  it('signs and verifies child workflow execution context', async () => {
    process.env.INTERNAL_API_SECRET = '12345678901234567890123456789012'
    vi.resetModules()

    const { generateInternalToken, verifyInternalTokenDetailed } = await import('./internal')
    const token = await generateInternalToken('user-1', {
      workflowExecution: {
        source: 'workflow_block',
        parentWorkflowId: 'parent-workflow-1',
        parentExecutionId: 'parent-execution-1',
        parentBlockId: 'workflow-block-1',
      },
    })

    await expect(verifyInternalTokenDetailed(token)).resolves.toMatchObject({
      valid: true,
      userId: 'user-1',
      workflowExecution: {
        source: 'workflow_block',
        parentWorkflowId: 'parent-workflow-1',
        parentExecutionId: 'parent-execution-1',
        parentBlockId: 'workflow-block-1',
      },
    })
  })
})
