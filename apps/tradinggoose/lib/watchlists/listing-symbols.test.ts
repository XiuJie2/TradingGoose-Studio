/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { resolveListingIdentitiesMock } = vi.hoisted(() => ({
  resolveListingIdentitiesMock: vi.fn(),
}))

vi.mock('@/lib/listing/resolve', () => ({
  resolveListingIdentities: resolveListingIdentitiesMock,
}))

import { attachWatchlistListingSymbols } from './listing-symbols'

const nvda = {
  listing_id: 'TG_LSTG_822870',
  base_id: '',
  quote_id: '',
  listing_type: 'default' as const,
}
const unknown = {
  listing_id: 'TG_LSTG_DEAD01',
  base_id: '',
  quote_id: '',
  listing_type: 'default' as const,
}

const items = [
  { id: 'section-1', type: 'section' as const, parentId: null, label: 'Semiconductors' },
  { id: 'item-1', type: 'listing' as const, parentId: null, listing: nvda },
  { id: 'item-2', type: 'listing' as const, parentId: null, listing: unknown },
]

describe('attachWatchlistListingSymbols', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveListingIdentitiesMock.mockResolvedValue({
      'default|TG_LSTG_822870||': {
        listingIdentity: nvda,
        base: 'NVDA',
        name: 'NVIDIA Corporation',
      },
    })
  })

  it('attaches the ticker while leaving the stored identity untouched', async () => {
    const result: any[] = await attachWatchlistListingSymbols(items as never)

    expect(result[1]).toEqual({
      id: 'item-1',
      type: 'listing',
      parentId: null,
      listing: nvda,
      symbol: 'NVDA',
      name: 'NVIDIA Corporation',
    })
  })

  it('marks an unresolved listing with a null symbol instead of dropping it', async () => {
    const result: any[] = await attachWatchlistListingSymbols(items as never)

    // Dropping it would read as "not in the watchlist", which is worse than
    // "in the watchlist, ticker unknown".
    expect(result).toHaveLength(3)
    expect(result[2]).toMatchObject({ id: 'item-2', symbol: null, name: null })
  })

  it('leaves section items alone', async () => {
    const result: any[] = await attachWatchlistListingSymbols(items as never)

    expect(result[0]).toEqual(items[0])
  })

  it('still returns the watchlist when the market service is down', async () => {
    resolveListingIdentitiesMock.mockRejectedValue(new Error('market search failed with 503'))

    const result: any[] = await attachWatchlistListingSymbols(items as never)

    expect(result).toHaveLength(3)
    expect(result[1]).toMatchObject({ symbol: null, name: null, listing: nvda })
  })

  it('propagates an abort rather than reporting unresolved tickers', async () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    resolveListingIdentitiesMock.mockRejectedValue(abort)

    await expect(attachWatchlistListingSymbols(items as never)).rejects.toThrow('aborted')
  })

  it('skips the market call for a watchlist with no listings', async () => {
    const sectionsOnly = [items[0]]

    const result = await attachWatchlistListingSymbols(sectionsOnly as never)

    expect(result).toEqual(sectionsOnly)
    expect(resolveListingIdentitiesMock).not.toHaveBeenCalled()
  })
})
