import type { MessageSummaryDto } from '../../shared/models';

/** One entry of a message feed: a message, or the messages of one album sent together. */
export type FeedEntry =
  | { readonly kind: 'single'; readonly key: string; readonly item: MessageSummaryDto }
  | { readonly kind: 'album'; readonly key: string; readonly items: readonly MessageSummaryDto[] };

function albumOf(item: MessageSummaryDto): string | null {
  return item.mediaGroupId === null ? null : `${item.channel.id}:${item.mediaGroupId}`;
}

/**
 * Groups consecutive messages of one album (same channel and album id) into one entry. Telegram
 * sends an album as separate messages in a row, so a page that ends inside an album simply
 * continues it when the next page is appended.
 */
export function groupAlbums(items: readonly MessageSummaryDto[]): FeedEntry[] {
  const entries: FeedEntry[] = [];
  let currentAlbum: string | null = null;
  for (const item of items) {
    const album = albumOf(item);
    const last = entries.at(-1);
    if (album !== null && album === currentAlbum && last) {
      const items = last.kind === 'album' ? [...last.items, item] : [last.item, item];
      // Keyed by the album's first message, which stays the same as the album grows.
      entries[entries.length - 1] = { kind: 'album', key: `album-${items[0]?.id}`, items };
      continue;
    }
    currentAlbum = album;
    entries.push({ kind: 'single', key: item.id, item });
  }
  return entries;
}
