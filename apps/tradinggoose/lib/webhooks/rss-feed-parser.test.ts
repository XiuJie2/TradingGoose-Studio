/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { parseFeed } from './rss-feed-parser'

const rss = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example Business</title>
    <link>https://example.test</link>
    <description>Markets</description>
    <item>
      <title>Chipmaker raises guidance</title>
      <link>https://example.test/a</link>
      <pubDate>Wed, 20 Aug 2026 12:00:00 GMT</pubDate>
      <guid isPermaLink="false">tag:example.test,2026:a</guid>
      <description>Summary A</description>
    </item>
    <item>
      <title>Fed holds rates</title>
      <link>https://example.test/b</link>
      <pubDate>Wed, 20 Aug 2026 11:00:00 GMT</pubDate>
      <description>Summary B</description>
    </item>
  </channel>
</rss>`

const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Atom</title>
  <link href="https://atom.test"/>
  <subtitle>Filings</subtitle>
  <entry>
    <title>8-K filed</title>
    <link href="https://atom.test/8k"/>
    <id>urn:uuid:1234</id>
    <updated>2026-08-20T09:00:00Z</updated>
    <summary>Material event</summary>
  </entry>
</feed>`

describe('parseFeed', () => {
  it('reads RSS items and prefers guid as the identity', () => {
    const { feed, items } = parseFeed(rss)

    expect(feed.title).toBe('Example Business')
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      id: 'tag:example.test,2026:a',
      title: 'Chipmaker raises guidance',
      link: 'https://example.test/a',
      pubDate: 'Wed, 20 Aug 2026 12:00:00 GMT',
    })
  })

  it('falls back to the link when an item has no guid', () => {
    const { items } = parseFeed(rss)

    expect(items[1].id).toBe('https://example.test/b')
  })

  it('reads Atom, where the link is an attribute and the date may only be `updated`', () => {
    const { feed, items } = parseFeed(atom)

    expect(feed.link).toBe('https://atom.test')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'urn:uuid:1234',
      link: 'https://atom.test/8k',
      pubDate: '2026-08-20T09:00:00Z',
    })
  })

  it('gives an item with neither guid nor link a stable synthetic id', () => {
    const bare = `<rss><channel><item>
      <title>No identity</title><pubDate>Wed, 20 Aug 2026 10:00:00 GMT</pubDate>
    </item></channel></rss>`

    const first = parseFeed(bare).items[0].id
    const second = parseFeed(bare).items[0].id

    // An id that changed between polls would re-deliver the same item forever.
    expect(first).toBe(second)
    expect(first).toHaveLength(40)
  })

  it('returns no items for a feed with none rather than throwing', () => {
    expect(parseFeed('<rss><channel><title>Empty</title></channel></rss>').items).toEqual([])
  })
})
