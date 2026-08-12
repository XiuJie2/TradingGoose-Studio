import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAnd = vi.fn((...conditions: unknown[]) => ({ kind: 'and', conditions }))
const mockDecryptSecret = vi.fn()
const mockDeleteWhere = vi.fn().mockResolvedValue(undefined)
const mockEq = vi.fn((left: unknown, right: unknown) => ({ kind: 'eq', left, right }))
const mockEncryptSecret = vi.fn()
const mockGetEnv = vi.fn<(variable: string) => string | undefined>()
const mockInsertValues = vi.fn().mockResolvedValue(undefined)
const mockSelect = vi.fn()
const mockSelectFrom = vi.fn()
const mockSelectOrderBy = vi.fn()
const mockSelectWhere = vi.fn()
const mockTransaction = vi.fn()
const mockTxDelete = vi.fn()
const mockTxInsert = vi.fn()

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  systemServiceValue: {
    id: 'system_service_values.id',
    service: 'system_service_values.service',
    kind: 'system_service_values.kind',
    key: 'system_service_values.key',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => mockAnd(...conditions),
  eq: (left: unknown, right: unknown) => mockEq(left, right),
}))

vi.mock('@/lib/utils-server', () => ({
  decryptSecret: (...args: unknown[]) => mockDecryptSecret(...args),
  encryptSecret: (...args: unknown[]) => mockEncryptSecret(...args),
}))

vi.mock('@/lib/env', () => ({
  getEnv: (variable: string) => mockGetEnv(variable),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock('./catalog', () => {
  const definition = {
    id: 'browserbase',
    displayName: 'Browserbase',
    description: 'Browser sessions',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        description: 'Credential',
        envVar: 'BROWSERBASE_API_KEY',
      },
    ],
    settingFields: [
      {
        key: 'projectId',
        label: 'Project ID',
        description: 'Project',
        type: 'text',
        defaultValue: 'default_project',
        envVar: 'BROWSERBASE_PROJECT_ID',
      },
    ],
  }

  return {
    getSystemServiceDefinitions: () => [definition],
    getSystemServiceDefinition: (serviceId: string) =>
      serviceId === definition.id ? definition : undefined,
    isSystemServiceCredentialKey: (serviceId: string, key: string) =>
      serviceId === definition.id && key === 'apiKey',
    isSystemServiceSettingKey: (serviceId: string, key: string) =>
      serviceId === definition.id && key === 'projectId',
  }
})

describe('system services service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetEnv.mockReturnValue(undefined)

    mockSelect.mockImplementation(() => ({
      from: mockSelectFrom,
    }))
    mockSelectFrom.mockImplementation(() => ({
      orderBy: mockSelectOrderBy,
      where: mockSelectWhere,
    }))
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        delete: mockTxDelete,
        insert: mockTxInsert,
      })
    )
    mockTxDelete.mockImplementation(() => ({
      where: mockDeleteWhere,
    }))
    mockTxInsert.mockImplementation(() => ({
      values: mockInsertValues,
    }))
  })

  it('lists credentials and settings from the unified system service values table', async () => {
    const { listSystemServices } = await import('./service')

    mockSelectOrderBy.mockResolvedValueOnce([
      {
        id: 'browserbase:credential:apiKey',
        service: 'browserbase',
        kind: 'credential',
        key: 'apiKey',
        value: 'encrypted-api-key',
      },
      {
        id: 'browserbase:setting:projectId',
        service: 'browserbase',
        kind: 'setting',
        key: 'projectId',
        value: 'proj_123',
      },
    ])

    const result = await listSystemServices()

    expect(result).toEqual([
      {
        id: 'browserbase',
        displayName: 'Browserbase',
        description: 'Browser sessions',
        credentials: [{ key: 'apiKey', hasValue: true }],
        settings: [{ key: 'projectId', hasValue: true, storedValue: 'proj_123' }],
      },
    ])
  })

  it('resolves credentials and settings from the unified table', async () => {
    const { resolveSystemServiceConfig } = await import('./service')

    mockSelectWhere
      .mockResolvedValueOnce([
        {
          id: 'browserbase:credential:apiKey',
          service: 'browserbase',
          kind: 'credential',
          key: 'apiKey',
          value: 'encrypted-api-key',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'browserbase:setting:projectId',
          service: 'browserbase',
          kind: 'setting',
          key: 'projectId',
          value: 'proj_123',
        },
      ])
    mockDecryptSecret.mockResolvedValueOnce({ decrypted: 'real-api-key' })

    const result = await resolveSystemServiceConfig('browserbase')

    expect(result).toEqual({
      apiKey: 'real-api-key',
      projectId: 'proj_123',
    })
  })

  it('falls back to the catalog env var when nothing is stored', async () => {
    const { resolveSystemServiceConfig } = await import('./service')

    mockSelectWhere.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    mockGetEnv.mockImplementation((variable) =>
      variable === 'BROWSERBASE_API_KEY'
        ? 'env-api-key'
        : variable === 'BROWSERBASE_PROJECT_ID'
          ? 'env_project'
          : undefined
    )

    await expect(resolveSystemServiceConfig('browserbase')).resolves.toEqual({
      apiKey: 'env-api-key',
      projectId: 'env_project',
    })
    expect(mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('prefers stored values over the env var', async () => {
    const { resolveSystemServiceConfig } = await import('./service')

    mockSelectWhere
      .mockResolvedValueOnce([
        {
          id: 'browserbase:credential:apiKey',
          service: 'browserbase',
          kind: 'credential',
          key: 'apiKey',
          value: 'encrypted-api-key',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'browserbase:setting:projectId',
          service: 'browserbase',
          kind: 'setting',
          key: 'projectId',
          value: 'proj_123',
        },
      ])
    mockDecryptSecret.mockResolvedValueOnce({ decrypted: 'stored-api-key' })
    mockGetEnv.mockReturnValue('env-value')

    await expect(resolveSystemServiceConfig('browserbase')).resolves.toEqual({
      apiKey: 'stored-api-key',
      projectId: 'proj_123',
    })
  })

  it('lets the env var win over the catalog default but not over a stored value', async () => {
    const { resolveSystemServiceSettingsConfig } = await import('./service')

    mockSelectWhere.mockResolvedValueOnce([])
    mockGetEnv.mockImplementation((variable) =>
      variable === 'BROWSERBASE_PROJECT_ID' ? 'env_project' : undefined
    )

    await expect(resolveSystemServiceSettingsConfig('browserbase')).resolves.toEqual({
      projectId: 'env_project',
    })
  })

  it('uses the catalog default when neither a stored value nor the env var is set', async () => {
    const { resolveSystemServiceSettingsConfig } = await import('./service')

    mockSelectWhere.mockResolvedValueOnce([])
    mockGetEnv.mockReturnValue(undefined)

    await expect(resolveSystemServiceSettingsConfig('browserbase')).resolves.toEqual({
      projectId: 'default_project',
    })
  })

  it('treats a blank env var as unset', async () => {
    const { resolveSystemServiceSettingsConfig } = await import('./service')

    mockSelectWhere.mockResolvedValueOnce([])
    mockGetEnv.mockReturnValue('   ')

    await expect(resolveSystemServiceSettingsConfig('browserbase')).resolves.toEqual({
      projectId: 'default_project',
    })
  })

  it('resolves settings without decrypting credentials when only public config is needed', async () => {
    const { resolveSystemServiceSettingsConfig } = await import('./service')

    mockSelectWhere.mockResolvedValueOnce([
      {
        id: 'browserbase:setting:projectId',
        service: 'browserbase',
        kind: 'setting',
        key: 'projectId',
        value: 'proj_123',
      },
    ])

    const result = await resolveSystemServiceSettingsConfig('browserbase')

    expect(result).toEqual({
      projectId: 'proj_123',
    })
    expect(mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('writes credentials and settings back into one table with kind-specific ids', async () => {
    const { upsertSystemServiceConfig } = await import('./service')

    const createdAt = new Date('2026-04-12T00:00:00.000Z')

    mockSelectWhere.mockResolvedValueOnce([
      {
        id: 'browserbase:credential:apiKey',
        service: 'browserbase',
        kind: 'credential',
        key: 'apiKey',
        value: 'encrypted-old',
        createdAt,
      },
      {
        id: 'browserbase:setting:projectId',
        service: 'browserbase',
        kind: 'setting',
        key: 'projectId',
        value: 'proj_old',
        createdAt,
      },
    ])
    mockEncryptSecret.mockResolvedValueOnce({ encrypted: 'encrypted-new' })

    await upsertSystemServiceConfig({
      serviceId: 'browserbase',
      credentials: [{ key: 'apiKey', value: 'next-api-key', hasValue: true }],
      settings: [{ key: 'projectId', value: 'proj_next', hasValue: true }],
    })

    expect(mockTxDelete).toHaveBeenCalledWith({
      id: 'system_service_values.id',
      service: 'system_service_values.service',
      kind: 'system_service_values.kind',
      key: 'system_service_values.key',
    })
    expect(mockDeleteWhere).toHaveBeenCalled()
    expect(mockTxInsert).toHaveBeenCalledWith({
      id: 'system_service_values.id',
      service: 'system_service_values.service',
      kind: 'system_service_values.kind',
      key: 'system_service_values.key',
    })
    expect(mockInsertValues).toHaveBeenCalledWith([
      {
        id: 'browserbase:credential:apiKey',
        service: 'browserbase',
        kind: 'credential',
        key: 'apiKey',
        value: 'encrypted-new',
        createdAt,
        updatedAt: expect.any(Date),
      },
      {
        id: 'browserbase:setting:projectId',
        service: 'browserbase',
        kind: 'setting',
        key: 'projectId',
        value: 'proj_next',
        createdAt,
        updatedAt: expect.any(Date),
      },
    ])
  })
})
