import type { MessageEntityDto, MessageEntityKind } from '../../shared/models';

/** A piece of text with one formatting. */
export interface TextRun {
  readonly text: string;
  /** CSS classes of the formatting: b, i, u, s, code, spoiler, tag. */
  readonly classes: string;
  /** Where the piece links to (http, https, tg or mailto only). */
  readonly href: string | null;
  readonly spoiler: boolean;
}

/** A paragraph-level part of a message: plain text, a quote, or a code block. */
export type TextBlock =
  | { readonly kind: 'text'; readonly runs: readonly TextRun[] }
  | { readonly kind: 'quote'; readonly runs: readonly TextRun[] }
  | { readonly kind: 'pre'; readonly text: string; readonly language: string | null };

const INLINE_CLASSES: Partial<Record<MessageEntityKind, string>> = {
  bold: 'b',
  italic: 'i',
  underline: 'u',
  strike: 's',
  code: 'code',
  spoiler: 'spoiler',
  mention: 'tag',
  hashtag: 'tag',
  cashtag: 'tag',
  botCommand: 'tag',
};

const LINK_KINDS: ReadonlySet<MessageEntityKind> = new Set([
  'link',
  'textLink',
  'mention',
  'email',
]);
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'tg:', 'mailto:']);

function safeUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return SAFE_PROTOCOLS.has(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Where a link-like entity points; null when it is not a safe link. */
export function linkTarget(entity: MessageEntityDto, text: string): string | null {
  const value = text.slice(entity.offset, entity.offset + entity.length);
  switch (entity.kind) {
    case 'textLink':
      return safeUrl(entity.url);
    case 'link':
      return safeUrl(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
    case 'mention':
      return /^@[A-Za-z0-9_]{4,32}$/.test(value) ? `https://t.me/${value.slice(1)}` : null;
    case 'email':
      return /^[^\s@]+@[^\s@]+$/.test(value) ? `mailto:${value}` : null;
    default:
      return null;
  }
}

function runsOf(
  text: string,
  start: number,
  end: number,
  entities: readonly MessageEntityDto[],
): TextRun[] {
  const cuts = new Set([start, end]);
  for (const entity of entities) {
    const from = Math.max(start, entity.offset);
    const to = Math.min(end, entity.offset + entity.length);
    if (from < to) {
      cuts.add(from);
      cuts.add(to);
    }
  }
  const points = [...cuts].sort((a, b) => a - b);
  const runs: TextRun[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index] as number;
    const to = points[index + 1] as number;
    const active = entities.filter(
      (entity) => entity.offset <= from && entity.offset + entity.length >= to,
    );
    const classes = [...new Set(active.flatMap((entity) => INLINE_CLASSES[entity.kind] ?? []))]
      .sort()
      .join(' ');
    // The innermost link wins.
    const link = active
      .filter((entity) => LINK_KINDS.has(entity.kind))
      .sort((a, b) => a.length - b.length)[0];
    const href = link ? linkTarget(link, text) : null;
    const piece = text.slice(from, to);
    const previous = runs.at(-1);
    if (previous && previous.classes === classes && previous.href === href) {
      runs[runs.length - 1] = { ...previous, text: previous.text + piece };
    } else {
      runs.push({ text: piece, classes, href, spoiler: classes.split(' ').includes('spoiler') });
    }
  }
  return runs;
}

/**
 * Splits a message into blocks and formatted runs, for templates to render without innerHTML.
 * Code blocks and quotes become blocks (a block overlapping an earlier one is ignored); the rest of
 * the formatting nests freely inside them.
 */
export function formatText(
  text: string | null,
  entities: readonly MessageEntityDto[],
): TextBlock[] {
  if (!text) {
    return [];
  }
  const valid = entities.filter(
    (entity) =>
      entity.offset >= 0 && entity.length > 0 && entity.offset + entity.length <= text.length,
  );
  const blocks: { start: number; end: number; entity: MessageEntityDto }[] = [];
  for (const entity of valid
    .filter((candidate) => candidate.kind === 'pre' || candidate.kind === 'blockquote')
    .sort((a, b) => a.offset - b.offset)) {
    const last = blocks.at(-1);
    if (last && entity.offset < last.end) {
      continue;
    }
    blocks.push({ start: entity.offset, end: entity.offset + entity.length, entity });
  }
  const inline = valid.filter((entity) => entity.kind !== 'pre' && entity.kind !== 'blockquote');
  const result: TextBlock[] = [];
  let position = 0;
  for (const block of blocks) {
    if (block.start > position) {
      result.push({ kind: 'text', runs: runsOf(text, position, block.start, inline) });
    }
    result.push(
      block.entity.kind === 'pre'
        ? {
            kind: 'pre',
            text: text.slice(block.start, block.end),
            language: block.entity.language ?? null,
          }
        : { kind: 'quote', runs: runsOf(text, block.start, block.end, inline) },
    );
    position = block.end;
  }
  if (position < text.length) {
    result.push({ kind: 'text', runs: runsOf(text, position, text.length, inline) });
  }
  return result;
}
