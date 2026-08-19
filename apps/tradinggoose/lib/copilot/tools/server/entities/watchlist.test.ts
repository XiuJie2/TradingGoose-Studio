import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WATCHLIST_DOCUMENT_FORMAT } from '@/lib/copilot/entity-documents'
import { readWatchlistServerTool } from './watchlist'

const mockVerifyReviewTargetAccess = vi.hoisted(() => vi.fn())
const mockReadBootstrappedSavedEntityFields = vi.hoisted(() => vi.fn())
const mockReadEntityListMembersFromDb = vi.hoisted(() => vi.fn())
const mockResolveListingIdentities = vi.hoisted(() => vi.fn())

vi.mock('@/lib/copilot/review-sessions/permissions', () => ({
  verifyReviewTargetAccess: (...args: unknown[]) => mockVerifyReviewTargetAccess(...args),
}))

vi.mock('@/lib/yjs/server/bootstrap-review-target', () => ({
  readBootstrappedSavedEntityFields: (...args: unknown[]) =>
    mockReadBootstrappedSavedEntityFields(...args),
}))

vi.mock('@/lib/yjs/server/entity-loaders', () => ({
  readEntityListMembersFromDb: (...args: unknown[]) => mockReadEntityListMembersFromDb(...args),
}))

vi.mock('@/lib/listing/resolve', () => ({
  resolveListingIdentities: (...args: unknown[]) => mockResolveListingIdentities(...args),
}))

const nvidia = {
  listing_id: 'TG_LSTG_822870',
  base_id: '',
  quote_id: '',
  listing_type: 'default' as const,
}
const delisted = {
  listing_id: 'TG_LSTG_B8A2A6',
  base_id: '',
  quote_id: '',
  listing_type: 'default' as const,
}

const watchlistDocument = {
  settings: { showLogo: true, showTicker: true, showDescription: false },
  items: [
    { id: 'section-1', type: 'section', label: 'Semiconductors' },
    { id: 'item-1', type: 'listing', parentId: null, listing: nvidia },
    { id: 'item-2', type: 'listing', parentId: null, listing: delisted },
  ],
}

const context = { userId: 'user-1', workspaceId: 'workspace-1', accessLevel: 'full' as const }

describe('read_watchlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVerifyReviewTargetAccess.mockResolvedValue({
      hasAccess: true,
      workspaceId: 'workspace-1',
    })
    mockReadBootstrappedSavedEntityFields.mockResolvedValue(watchlistDocument)
    mockReadEntityListMembersFromDb.mockResolvedValue([{ id: 'watchlist-1', name: 'Watchlist' }])
    mockResolveListingIdentities.mockResolvedValue({
      'default|TG_LSTG_822870||': {
        listingIdentity: nvidia,
        base: 'NVDA',
        name: 'NVIDIA Corporation',
      },
    })
  })

  it('answers with tickers instead of opaque listing ids', async () => {
    const result: any = await readWatchlistServerTool.execute({ entityId: 'watchlist-1' }, context)

    expect(result.listings).toEqual([
      { listing: nvidia, symbol: 'NVDA', name: 'NVIDIA Corporation' },
      // An identity the market service does not know is still reported: dropping
      // it would read as the listing not being in the watchlist at all.
      { listing: delisted, symbol: null, name: null },
    ])
  })

  it('leaves the document itself untouched so it can be written back', async () => {
    const result: any = await readWatchlistServerTool.execute({ entityId: 'watchlist-1' }, context)

    // The document schema is strict and an edit sends this same document back, so
    // resolved tickers must not be merged into its items.
    expect(result.documentFormat).toBe(WATCHLIST_DOCUMENT_FORMAT)

    const document = JSON.parse(result.entityDocument)
    expect(document.items.map((item: any) => Object.keys(item).sort())).toEqual([
      ['id', 'label', 'parentId', 'type'],
      ['id', 'listing', 'parentId', 'type'],
      ['id', 'listing', 'parentId', 'type'],
    ])
    expect(document.items[1].listing).toEqual(nvidia)
  })

  it('still reads the watchlist when the market service is unavailable', async () => {
    mockResolveListingIdentities.mockRejectedValue(new Error('market search failed with 503'))

    const result: any = await readWatchlistServerTool.execute({ entityId: 'watchlist-1' }, context)

    expect(result.listingsError).toContain('market search failed with 503')
    expect(result.listings).toEqual([
      { listing: nvidia, symbol: null, name: null },
      { listing: delisted, symbol: null, name: null },
    ])
    expect(JSON.parse(result.entityDocument).items).toHaveLength(3)
  })

  it('propagates an abort rather than reporting it as unresolved tickers', async () => {
    const abort = new Error('The operation was aborted')
    abort.name = 'AbortError'
    mockResolveListingIdentities.mockRejectedValue(abort)

    await expect(
      readWatchlistServerTool.execute({ entityId: 'watchlist-1' }, context)
    ).rejects.toThrow('The operation was aborted')
  })
})

describe('read_watchlist result contract', () => {
  it('carries the resolved tickers through to the model', async () => {
    // routeExecution runs every tool result through its contract schema, and zod
    // strips keys the schema does not declare. Resolving tickers in the tool is
    // not enough on its own: without this field the model receives the envelope
    // with the listings quietly removed.
    const { getToolContract } = await import('@/lib/copilot/registry')
    const contract = getToolContract('read_watchlist')

    const parsed: any = contract?.result.parse({
      entityKind: 'watchlist',
      entityId: 'watchlist-1',
      entityName: 'Watchlist',
      documentFormat: WATCHLIST_DOCUMENT_FORMAT,
      entityDocument: JSON.stringify(watchlistDocument),
      listings: [{ listing: nvidia, symbol: 'NVDA', name: 'NVIDIA Corporation' }],
    })

    expect(parsed.listings).toEqual([
      { listing: nvidia, symbol: 'NVDA', name: 'NVIDIA Corporation' },
    ])
  })
})
