import { db } from '@tradinggoose/db'
import { webhook } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { pollingIdempotency } from '@/lib/idempotency/service'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import { parseFeed, type RssFeedItem } from '@/lib/webhooks/rss-feed-parser'
import { getWebhookRevision, WebhookRevisionConflictError } from '@/lib/webhooks/webhook-helpers'

const logger = createLogger('RssPollingService')

/** Feeds routinely republish their whole window, so recency alone cannot decide what is new. */
const SEEN_ITEM_HISTORY = 200

/** A burst should not turn into a burst of workflow runs. */
const DEFAULT_MAX_ITEMS_PER_POLL = 20

const FETCH_TIMEOUT_MS = 20_000
const MAX_FEED_BYTES = 5 * 1024 * 1024

const CONCURRENCY = 10

export interface RssWebhookConfig {
  feedUrl?: string
  lastCheckedTimestamp?: string
  /** Item ids already delivered, newest first, capped at SEEN_ITEM_HISTORY. */
  seenItemIds?: string[]
  maxItemsPerPoll?: number
  /** Set once the first poll has recorded a baseline. */
  initialized?: boolean
}

export interface RssPollResult {
  total: number
  successful: number
  failed: number
  details: Array<Record<string, unknown>>
}

export async function fetchFeed(feedUrl: string): Promise<string> {
  let url: URL
  try {
    url = new URL(feedUrl)
  } catch {
    throw new Error(`Feed URL is not a valid URL: ${feedUrl}`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Feed URL must be http or https, got ${url.protocol}`)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
      signal: controller.signal,
      redirect: 'follow',
    })

    if (!response.ok) {
      throw new Error(`Feed request failed with ${response.status}`)
    }

    const body = await response.text()
    if (body.length > MAX_FEED_BYTES) {
      // A poller that OOMs takes every other feed down with it.
      throw new Error(`Feed exceeded ${MAX_FEED_BYTES} bytes`)
    }

    return body
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Feed request timed out after ${FETCH_TIMEOUT_MS}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Decides which items to deliver, and how the seen list should look afterwards.
 *
 * Kept separate from the polling loop so the rule that actually matters — a
 * first poll must not deliver the feed's entire backlog — is testable without a
 * database or a network.
 */
export function selectNewItems(
  items: RssFeedItem[],
  config: RssWebhookConfig
): { deliver: RssFeedItem[]; seenItemIds: string[] } {
  const seen = new Set(config.seenItemIds ?? [])
  const unseen = items.filter((item) => !seen.has(item.id))

  // Feeds list newest first; delivering in feed order would run the workflow on
  // the newest item first and the oldest last.
  const chronological = [...unseen].reverse()

  const nextSeen = (ids: string[]) =>
    [...ids, ...(config.seenItemIds ?? [])].slice(0, SEEN_ITEM_HISTORY)

  // First poll records a baseline instead of firing. Subscribing to a feed with
  // fifty items in its window should not produce fifty workflow runs.
  if (!config.initialized) {
    return { deliver: [], seenItemIds: nextSeen(items.map((item) => item.id)) }
  }

  const limit = Math.max(1, config.maxItemsPerPoll ?? DEFAULT_MAX_ITEMS_PER_POLL)
  const deliver = chronological.slice(-limit)

  // Everything unseen is marked seen, including items dropped by the limit:
  // re-delivering them on the next tick would defeat the limit's purpose.
  return { deliver, seenItemIds: nextSeen(unseen.map((item) => item.id)) }
}

async function updateWebhookState(
  current: Pick<typeof webhook.$inferSelect, 'id' | 'providerConfig' | 'updatedAt'>,
  patch: Partial<RssWebhookConfig>
) {
  const revision = getWebhookRevision(
    current,
    eq(webhook.provider, 'rss'),
    eq(webhook.isActive, true)
  )

  const [updated] = await db
    .update(webhook)
    .set({
      providerConfig: {
        ...((current.providerConfig as Record<string, unknown>) || {}),
        ...patch,
      },
      updatedAt: revision.updatedAt,
    })
    .where(revision.where)
    .returning({ id: webhook.id })

  if (!updated) throw new WebhookRevisionConflictError()
}

async function deliverItem(
  item: RssFeedItem,
  feedMeta: Record<string, unknown>,
  webhookData: { id: string; path: string },
  requestId: string
) {
  return pollingIdempotency.executeWithIdempotency(
    'rss',
    `${webhookData.id}:${item.id}`,
    async () => {
      // Field names match the rss_poller trigger's declared outputs.
      const payload = {
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
        item: item.raw,
        feed: feedMeta,
      }

      const response = await fetch(`${getBaseUrl()}/api/webhooks/trigger/${webhookData.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        logger.error(`[${requestId}] Failed to trigger webhook for item ${item.id}`, {
          status: response.status,
        })
        return { delivered: false, status: response.status }
      }

      return { delivered: true, status: response.status }
    }
  )
}

export async function pollRssWebhooks(): Promise<RssPollResult> {
  const activeWebhooks = await db
    .select()
    .from(webhook)
    .where(and(eq(webhook.provider, 'rss'), eq(webhook.isActive, true)))

  if (!activeWebhooks.length) {
    logger.info('No active RSS webhooks found')
    return { total: 0, successful: 0, failed: 0, details: [] }
  }

  logger.info(`Found ${activeWebhooks.length} active RSS webhooks`)

  const pollOne = async (webhookData: (typeof activeWebhooks)[number]) => {
    const requestId = nanoid()
    const config = (webhookData.providerConfig ?? {}) as RssWebhookConfig

    try {
      if (!config.feedUrl) {
        return { success: false, webhookId: webhookData.id, error: 'Missing feedUrl' }
      }

      const body = await fetchFeed(config.feedUrl)
      const { items, feed } = parseFeed(body)
      const { deliver, seenItemIds } = selectNewItems(items, config)

      let delivered = 0
      for (const item of deliver) {
        const result = await deliverItem(item, feed, webhookData, requestId)
        if (result.delivered) delivered += 1
      }

      await updateWebhookState(webhookData, {
        lastCheckedTimestamp: new Date().toISOString(),
        seenItemIds,
        initialized: true,
      })

      if (!config.initialized) {
        logger.info(`[${requestId}] Recorded ${items.length} existing items as the baseline`, {
          webhookId: webhookData.id,
        })
        return { success: true, webhookId: webhookData.id, status: 'baseline', items: items.length }
      }

      return { success: true, webhookId: webhookData.id, itemsFound: deliver.length, delivered }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      logger.error(`[${requestId}] Error polling RSS webhook ${webhookData.id}:`, error)
      return { success: false, webhookId: webhookData.id, error: message }
    }
  }

  const details: Array<Record<string, unknown>> = []
  for (let index = 0; index < activeWebhooks.length; index += CONCURRENCY) {
    const batch = activeWebhooks.slice(index, index + CONCURRENCY)
    const settled = await Promise.all(batch.map(pollOne))
    details.push(...settled)
  }

  const successful = details.filter((detail) => detail.success).length

  return {
    total: details.length,
    successful,
    failed: details.length - successful,
    details,
  }
}
