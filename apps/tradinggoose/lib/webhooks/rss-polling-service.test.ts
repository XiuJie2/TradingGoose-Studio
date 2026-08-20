/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { RssFeedItem } from './rss-feed-parser'
import { selectNewItems } from './rss-polling-service'

const item = (id: string): RssFeedItem => ({
  id,
  title: `title ${id}`,
  link: `https://example.test/${id}`,
  pubDate: '',
  raw: {},
})

// Feeds list newest first.
const feedItems = [item('e'), item('d'), item('c'), item('b'), item('a')]

describe('selectNewItems', () => {
  it('delivers nothing on the first poll and records a baseline', () => {
    // Subscribing to a feed whose window holds fifty items must not produce
    // fifty workflow runs, and every one of those a Telegram message.
    const result = selectNewItems(feedItems, {})

    expect(result.deliver).toEqual([])
    expect(result.seenItemIds).toEqual(['e', 'd', 'c', 'b', 'a'])
  })

  it('delivers only unseen items once initialized', () => {
    const result = selectNewItems(feedItems, {
      initialized: true,
      seenItemIds: ['c', 'b', 'a'],
    })

    expect(result.deliver.map((entry) => entry.id)).toEqual(['d', 'e'])
  })

  it('delivers oldest first so the workflow sees the feed in publication order', () => {
    const result = selectNewItems(feedItems, { initialized: true, seenItemIds: ['a'] })

    expect(result.deliver.map((entry) => entry.id)).toEqual(['b', 'c', 'd', 'e'])
  })

  it('delivers nothing when the feed has not moved', () => {
    const result = selectNewItems(feedItems, {
      initialized: true,
      seenItemIds: ['e', 'd', 'c', 'b', 'a'],
    })

    expect(result.deliver).toEqual([])
  })

  it('caps a burst and still marks the dropped items seen', () => {
    const result = selectNewItems(feedItems, {
      initialized: true,
      seenItemIds: [],
      maxItemsPerPoll: 2,
    })

    // Newest two of the burst.
    expect(result.deliver.map((entry) => entry.id)).toEqual(['d', 'e'])
    // The three it skipped are marked seen too; re-offering them next tick
    // would defeat the cap and deliver the backlog one tick later.
    expect(result.seenItemIds).toEqual(expect.arrayContaining(['a', 'b', 'c', 'd', 'e']))
  })

  it('keeps the seen list bounded', () => {
    const many = Array.from({ length: 260 }, (_value, index) => item(`item-${index}`))
    const result = selectNewItems(many, {})

    expect(result.seenItemIds).toHaveLength(200)
    expect(result.seenItemIds[0]).toBe('item-0')
  })

  it('re-delivers an item only if it drops out of the seen window', () => {
    const seen = Array.from({ length: 200 }, (_value, index) => `filler-${index}`)
    const result = selectNewItems([item('old-story')], {
      initialized: true,
      seenItemIds: seen,
    })

    // Not a bug to fix here: a feed republishing something older than 200 items
    // ago is indistinguishable from a genuinely new item at this layer.
    expect(result.deliver.map((entry) => entry.id)).toEqual(['old-story'])
  })
})
