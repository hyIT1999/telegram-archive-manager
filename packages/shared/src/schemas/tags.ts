import { z } from 'zod';

export const TAG_NAME_MAX_LENGTH = 40;
/** Tags the archive holds at most, so that every list of them fits in one response. */
export const MAX_TAGS = 500;

function cleanTagName(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/** The form names are compared in: two names equal here are the same tag. */
export function normalizeTagName(name: string): string {
  return cleanTagName(name).toLowerCase();
}

/** Trimmed, inner spaces collapsed, 1–40 characters, no control characters. */
export const tagNameSchema = z
  .string()
  .transform(cleanTagName)
  .pipe(
    z
      .string()
      .min(1, 'Name the tag')
      .max(TAG_NAME_MAX_LENGTH)
      .refine((name) => !/\p{Cc}/u.test(name), 'Remove the control characters'),
  );

/** `#rrggbb`, stored in lower case. */
export const tagColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, 'Use a #rrggbb color')
  .transform((color) => color.toLowerCase());

/** POST /api/tags */
export const createTagRequestSchema = z.object({
  name: tagNameSchema,
  /** Null (or left out): the default look. */
  color: tagColorSchema.nullable().optional(),
});
export type CreateTagRequest = z.infer<typeof createTagRequestSchema>;

/** PATCH /api/tags/:id — rename, recolor, or both. */
export const updateTagRequestSchema = z
  .object({
    name: tagNameSchema.optional(),
    color: tagColorSchema.nullable().optional(),
  })
  .refine((value) => value.name !== undefined || value.color !== undefined, {
    message: 'Nothing to change',
  });
export type UpdateTagRequest = z.infer<typeof updateTagRequestSchema>;

/** POST /api/messages/:id/tags — an existing tag, or a name (the tag is created if needed). */
export const addMessageTagRequestSchema = z.union([
  z.object({ tagId: z.uuid() }),
  z.object({ name: tagNameSchema, color: tagColorSchema.nullable().optional() }),
]);
export type AddMessageTagRequest = z.infer<typeof addMessageTagRequestSchema>;

/** DELETE /api/messages/:id/tags/:tagId */
export const messageTagParamsSchema = z.object({ id: z.uuid(), tagId: z.uuid() });
export type MessageTagParams = z.infer<typeof messageTagParamsSchema>;

/** A tag as messages carry it. */
export interface TagRefDto {
  id: string;
  name: string;
  /** `#rrggbb`; null for the default look. */
  color: string | null;
}

/** GET /api/tags — one tag and how many messages carry it. */
export interface TagDto extends TagRefDto {
  messageCount: number;
  createdAt: string;
}

export interface TagListDto {
  items: TagDto[];
}

/** The tags of a message after it was tagged or untagged. */
export interface MessageTagsDto {
  tags: TagRefDto[];
}
