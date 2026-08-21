import { getListingIdentityKey } from '@/lib/listing/identity'
import { resolveListingIdentities } from '@/lib/listing/resolve'
import { createLogger } from '@/lib/logs/console/logger'
import type { WatchlistItem, WatchlistListingItem } from '@/lib/watchlists/types'

const logger = createLogger('WatchlistListingSymbols')

/**
 * A listing item with the ticker attached.
 *
 * `listing` stays exactly as stored so anything reading the identity keeps
 * working; `symbol` and `name` are additions.
 */
export type WatchlistListingItemWithSymbol = WatchlistListingItem & {
  symbol: string | null
  name: string | null
}

export type WatchlistItemWithSymbol =
  | WatchlistListingItemWithSymbol
  | Exclude<WatchlistItem, WatchlistListingItem>

/**
 * Attaches tickers to a watchlist's listing items.
 *
 * A watchlist stores identities — `{ listing_id: 'TG_LSTG_822870', ... }` — and
 * nothing else. A workflow reading it therefore sees opaque ids where it expects
 * NVDA, which is impossible to act on and invites the worst possible workaround:
 * hardcoding the tickers into a Function block, where a typo becomes a position
 * in a company the watchlist never held.
 *
 * The tickers live in the market service, which is where the UI and the copilot's
 * own read_watchlist tool get them.
 */
export async function attachWatchlistListingSymbols(
  items: WatchlistItem[],
  signal?: AbortSignal
): Promise<WatchlistItemWithSymbol[]> {
  const listingItems = items.filter((item): item is WatchlistListingItem => item.type === 'listing')

  if (listingItems.length === 0) {
    return items as WatchlistItemWithSymbol[]
  }

  let resolved: Awaited<ReturnType<typeof resolveListingIdentities>> = {}
  try {
    resolved = await resolveListingIdentities(
      listingItems.map((item) => item.listing),
      signal
    )
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error
    }

    // Returning the watchlist without tickers beats failing the whole block:
    // the structure is still usable, and a null symbol says "unresolved" where
    // a missing item would say "not in the watchlist".
    logger.warn('Could not resolve watchlist listing symbols', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return items.map((item) => {
    if (item.type !== 'listing') {
      return item as WatchlistItemWithSymbol
    }

    const details = resolved[getListingIdentityKey(item.listing)] ?? null
    return {
      ...item,
      symbol: details?.base ?? null,
      name: details?.name ?? null,
    }
  })
}
