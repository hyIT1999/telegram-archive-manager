import type { Tag } from '@tam/database';
import type { TagDto, TagRefDto } from '@tam/shared';

/** What a message shows of each of its tags. */
export const TAG_REF_SELECT = { id: true, name: true, color: true } as const;

/** A message's tags, by name. */
export const MESSAGE_TAGS_INCLUDE = {
  include: { tag: { select: TAG_REF_SELECT } },
  orderBy: { tag: { nameNormalized: 'asc' } },
} as const;

/** How many messages carry the tag. */
export const TAG_WITH_COUNT = { _count: { select: { messages: true } } } as const;

export type TagRef = Pick<Tag, 'id' | 'name' | 'color'>;

export function toTagRefDto(tag: TagRef): TagRefDto {
  return { id: tag.id, name: tag.name, color: tag.color };
}

export function toTagDto(tag: Tag & { _count: { messages: number } }): TagDto {
  return {
    ...toTagRefDto(tag),
    messageCount: tag._count.messages,
    createdAt: tag.createdAt.toISOString(),
  };
}
