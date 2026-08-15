/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockListSystemServices, mockReadFieldEnvValue, mockUpsertSystemServiceConfig } = vi.hoisted(
  () => ({
    mockListSystemServices: vi.fn(),
    mockReadFieldEnvValue: vi.fn(),
    mockUpsertSystemServiceConfig: vi.fn(),
  })
)

vi.mock('@/lib/system-services/service', () => ({
  listSystemServices: (...args: any[]) => mockListSystemServices(...args),
  readFieldEnvValue: (...args: any[]) => mockReadFieldEnvValue(...args),
  upsertSystemServiceConfig: (...args: any[]) => mockUpsertSystemServiceConfig(...args),
  SystemServiceValidationError: class SystemServiceValidationError extends Error {},
}))

describe('admin system services', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockListSystemServices.mockResolvedValue([])
    mockReadFieldEnvValue.mockReturnValue(null)
  })

  it('reports an env-supplied credential as configured and says where it came from', async () => {
    mockReadFieldEnvValue.mockImplementation((envVar: string | undefined) =>
      envVar === 'COPILOT_API_KEY' ? 'from-environment' : null
    )

    const { listAdminSystemServices } = await import('./system-services')
    const snapshot = await listAdminSystemServices()

    const copilot = snapshot.services.find((service) => service.id === 'copilot_api')
    const apiKey = copilot?.credentials.find((credential) => credential.key === 'apiKey')

    expect(apiKey).toMatchObject({ hasValue: true, managedByEnv: true })
    expect(apiKey?.description).toContain('COPILOT_API_KEY')
  })

  it('mentions the env var as a fallback when nothing supplies a value', async () => {
    const { listAdminSystemServices } = await import('./system-services')
    const snapshot = await listAdminSystemServices()

    const copilot = snapshot.services.find((service) => service.id === 'copilot_api')
    const apiKey = copilot?.credentials.find((credential) => credential.key === 'apiKey')

    expect(apiKey).toMatchObject({ hasValue: false, managedByEnv: false })
    expect(apiKey?.description).toContain('Falls back to COPILOT_API_KEY')
  })

  it('marks optional Market API and Local Execution fields as non-blocking', async () => {
    const { listAdminSystemServices } = await import('./system-services')

    const snapshot = await listAdminSystemServices()

    const github = snapshot.services.find((service) => service.id === 'github')
    const marketApi = snapshot.services.find((service) => service.id === 'market_api')
    const localExecution = snapshot.services.find((service) => service.id === 'local_execution')
    const ollama = snapshot.services.find((service) => service.id === 'ollama')

    expect(github?.settings.find((setting) => setting.key === 'blogRepository')).toMatchObject({
      required: false,
      hasValue: false,
      defaultValue: 'TradingGoose/TradingGoose-Blog',
    })
    expect(github?.settings.find((setting) => setting.key === 'blogBranch')).toMatchObject({
      required: false,
      hasValue: false,
      defaultValue: 'main',
    })
    expect(marketApi?.credentials.find((credential) => credential.key === 'apiKey')).toMatchObject({
      required: false,
      hasValue: false,
    })
    expect(marketApi?.settings.find((setting) => setting.key === 'baseUrl')).toMatchObject({
      required: true,
      defaultValue: 'https://market.tradinggoose.ai',
    })
    expect(
      localExecution?.settings.find((setting) => setting.key === 'maxConcurrentExecutions')
    ).toMatchObject({
      required: true,
      defaultValue: '200',
    })
    expect(
      localExecution?.settings.find((setting) => setting.key === 'maxActivePerOwner')
    ).toMatchObject({
      required: false,
      hasValue: false,
      defaultValue: '',
    })
    expect(ollama?.settings.find((setting) => setting.key === 'baseUrl')).toMatchObject({
      required: true,
      defaultValue: 'http://localhost:11434',
    })
  })

  it('exposes optional model-provider keys for DeepSeek, OpenRouter, NVIDIA and MiniMax', async () => {
    const { listAdminSystemServices } = await import('./system-services')

    const snapshot = await listAdminSystemServices()

    for (const serviceId of ['deepseek', 'openrouter', 'nvidia', 'minimax']) {
      const service = snapshot.services.find((entry) => entry.id === serviceId)
      expect(service, `${serviceId} should be listed`).toBeDefined()
      expect(service?.credentials.find((credential) => credential.key === 'apiKey')).toMatchObject({
        required: false,
        hasValue: false,
        value: '',
      })

      for (const slot of ['rotationKey1', 'rotationKey2', 'rotationKey3']) {
        expect(
          service?.credentials.find((credential) => credential.key === slot),
          `${serviceId} should expose ${slot}`
        ).toMatchObject({ required: false, hasValue: false, value: '' })
      }
    }

    const nvidia = snapshot.services.find((service) => service.id === 'nvidia')
    expect(nvidia?.settings.find((setting) => setting.key === 'baseUrl')).toMatchObject({
      required: false,
      hasValue: false,
      defaultValue: 'https://integrate.api.nvidia.com/v1',
    })

    const minimax = snapshot.services.find((service) => service.id === 'minimax')
    expect(minimax?.settings.find((setting) => setting.key === 'baseUrl')).toMatchObject({
      required: false,
      hasValue: false,
      defaultValue: 'https://api.minimax.io/v1',
    })
  })
})
