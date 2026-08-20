import { createHash } from 'crypto'
import * as cheerio from 'cheerio'

export interface RssFeedItem {
  /** Stable across polls; see resolveItemId. */
  id: string
  title: string
  link: string
  pubDate: string
  raw: Record<string, unknown>
}

export interface ParsedFeed {
  feed: Record<string, unknown>
  items: RssFeedItem[]
}

/**
 * The id decides whether an item has been seen before, so it has to stay stable
 * across polls. `guid`/`id` is the feed's own answer and is preferred; `link` is
 * the usual fallback. Hashing title+date is the last resort — a feed that
 * supplies neither guid nor link would otherwise re-deliver every item on every
 * tick, because nothing would match the seen list.
 */
function resolveItemId(guid: string, link: string, title: string, pubDate: string): string {
  const candidate = guid.trim() || link.trim()
  if (candidate) return candidate

  return createHash('sha1').update(`${title}::${pubDate}`).digest('hex')
}

function text($el: cheerio.Cheerio<any>): string {
  return $el.first().text().trim()
}

/**
 * Parses RSS 2.0 and Atom into one shape.
 *
 * Atom differs in more than element names: its link is an attribute rather than
 * text, and its date lives in `published` or, for items that have only ever been
 * updated, `updated`.
 */
export function parseFeed(body: string): ParsedFeed {
  const $ = cheerio.load(body, { xmlMode: true })

  const channel = $('channel').first()
  const atomFeed = $('feed').first()
  const isAtom = channel.length === 0 && atomFeed.length > 0

  const feed: Record<string, unknown> = {
    title: text(isAtom ? atomFeed.children('title') : channel.children('title')),
    link: isAtom
      ? atomFeed.children('link').first().attr('href')?.trim() || ''
      : text(channel.children('link')),
    description: text(isAtom ? atomFeed.children('subtitle') : channel.children('description')),
  }

  const items: RssFeedItem[] = []

  $(isAtom ? 'entry' : 'item').each((_index, element) => {
    const $item = $(element)

    const title = text($item.children('title'))
    const link = isAtom
      ? $item.children('link').first().attr('href')?.trim() || ''
      : text($item.children('link'))
    const pubDate = isAtom
      ? text($item.children('published')) || text($item.children('updated'))
      : text($item.children('pubDate'))
    const guid = isAtom ? text($item.children('id')) : text($item.children('guid'))
    const description = isAtom
      ? text($item.children('summary')) || text($item.children('content'))
      : text($item.children('description'))

    items.push({
      id: resolveItemId(guid, link, title, pubDate),
      title,
      link,
      pubDate,
      raw: { title, link, pubDate, guid, description },
    })
  })

  return { feed, items }
}
