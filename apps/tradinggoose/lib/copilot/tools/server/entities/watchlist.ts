import { ENTITY_KIND_WATCHLIST } from '@/lib/copilot/review-sessions/types'
import { withWorkspaceArgContext } from '@/lib/copilot/tools/server/base-tool'
import {
  getListingIdentityKey,
  type ListingIdentity,
  ListingIdentitySchema,
} from '@/lib/listing/identity'
import { resolveListingIdentities } from '@/lib/listing/resolve'
import { createLogger } from '@/lib/logs/console/logger'
import { createWatchlistFromDocument } from '@/lib/watchlists/operations'
import {
  buildDocumentEnvelope,
  buildSavedEntityListInfo,
  type EntityServerTool,
  executeCreateEntityDocumentMutation,
  executeRenameEntityMutation,
  executeUpdateEntityDocumentMutation,
  type RenameEntityArgs,
  readSavedEntityDocument,
  requireEntityId,
  verifySavedEntityContext,
  verifyWorkspaceContext,
} from './shared'

const logger = createLogger('CopilotWatchlistTools')

type WatchlistListingSummary = {
  listing: ListingIdentity
  symbol: string | null
  name: string | null
}

function readListingIdentities(fields: Record<string, unknown>): ListingIdentity[] {
  const items = Array.isArray(fields.items) ? fields.items : []

  return items.flatMap((item) => {
    if (!item || typeof item !== 'object' || (item as { type?: unknown }).type !== 'listing') {
      return []
    }

    const parsed = ListingIdentitySchema.safeParse((item as { listing?: unknown }).listing)
    return parsed.success ? [parsed.data] : []
  })
}

/**
 * Resolves the tickers behind a watchlist's listing identities.
 *
 * A watchlist document stores identities only — `{ listing_id: 'TG_LSTG_822870', ... }` —
 * so reading one without this step answers "which stocks are in my watchlist?" with a
 * list of opaque ids. The tickers live in the market service, exactly as they do for
 * monitors, which resolve them the same way.
 *
 * The result stays beside the document rather than inside it: the document schema is
 * strict and the copilot edits a watchlist by sending the same document back, so an
 * extra key on an item would fail validation on write.
 */
async function summarizeWatchlistListings(
  fields: Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ listings: WatchlistListingSummary[]; listingsError?: string }> {
  const identities = readListingIdentities(fields)
  if (identities.length === 0) {
    return { listings: [] }
  }

  let resolved: Awaited<ReturnType<typeof resolveListingIdentities>>
  try {
    resolved = await resolveListingIdentities(identities, signal)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error
    }

    // Reading the watchlist still succeeds without the market service: its
    // structure is worth returning, and reporting the reason beats answering as
    // if these listings had no ticker.
    const message = error instanceof Error ? error.message : 'Listing resolution failed'
    logger.warn('Could not resolve watchlist listings', { error: message })

    return {
      listings: identities.map((listing) => ({ listing, symbol: null, name: null })),
      listingsError: `Could not resolve tickers from the market service: ${message}`,
    }
  }

  return {
    listings: identities.map((listing) => {
      // An unresolved entry is kept with a null symbol; dropping it would read as
      // the listing not being in the watchlist at all.
      const details = resolved[getListingIdentityKey(listing)] ?? null
      return {
        listing,
        symbol: details?.base ?? null,
        name: details?.name ?? null,
      }
    }),
  }
}

export const listWatchlistsServerTool: EntityServerTool<{ workspaceId?: string }> = {
  name: 'list_watchlist',
  async execute(args, context) {
    const { workspaceId } = await verifyWorkspaceContext(
      withWorkspaceArgContext(context, args),
      'read'
    )
    const entities = await buildSavedEntityListInfo(ENTITY_KIND_WATCHLIST, workspaceId)

    return {
      entityKind: ENTITY_KIND_WATCHLIST,
      entities,
      count: entities.length,
    }
  },
}

export const readWatchlistServerTool: EntityServerTool = {
  name: 'read_watchlist',
  async execute(args, context) {
    const entityId = requireEntityId(args, 'read_watchlist')
    const { workspaceId } = await verifySavedEntityContext(
      context,
      ENTITY_KIND_WATCHLIST,
      entityId,
      'read'
    )
    const document = await readSavedEntityDocument(ENTITY_KIND_WATCHLIST, entityId, workspaceId)
    const { listings, listingsError } = await summarizeWatchlistListings(
      document.fields,
      context?.signal
    )

    return {
      ...buildDocumentEnvelope(
        ENTITY_KIND_WATCHLIST,
        entityId,
        document.entityName,
        document.fields
      ),
      listings,
      ...(listingsError ? { listingsError } : {}),
    }
  },
}

export const createWatchlistServerTool: EntityServerTool = {
  name: 'create_watchlist',
  execute(args, context) {
    return executeCreateEntityDocumentMutation(
      ENTITY_KIND_WATCHLIST,
      args,
      context,
      async (name, fields, { workspaceId, beforeInsert }) => {
        const created = await createWatchlistFromDocument(
          { workspaceId },
          { name, ...fields },
          { beforeInsert }
        )
        const { name: entityName, ...content } = created.fields
        return { entityId: created.id, entityName, fields: content }
      }
    )
  },
}

export const editWatchlistServerTool: EntityServerTool = {
  name: 'edit_watchlist',
  execute(args, context) {
    return executeUpdateEntityDocumentMutation(
      ENTITY_KIND_WATCHLIST,
      'edit_watchlist',
      args,
      context
    )
  },
}

export const renameWatchlistServerTool: EntityServerTool<RenameEntityArgs> = {
  name: 'rename_watchlist',
  execute(args, context) {
    return executeRenameEntityMutation(ENTITY_KIND_WATCHLIST, 'rename_watchlist', args, context)
  },
}
