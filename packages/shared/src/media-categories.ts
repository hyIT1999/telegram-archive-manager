import { MediaType } from './enums.js';

/** Sidebar media sections and the media types each one lists. */
export const MEDIA_CATEGORIES = {
  videos: [MediaType.VIDEO, MediaType.ANIMATION, MediaType.VIDEO_NOTE],
  images: [MediaType.PHOTO, MediaType.STICKER],
  documents: [MediaType.DOCUMENT],
  audio: [MediaType.AUDIO, MediaType.VOICE],
} as const satisfies Record<string, readonly MediaType[]>;

export type MediaCategory = keyof typeof MEDIA_CATEGORIES;

export function mediaCategoryOf(type: MediaType): MediaCategory {
  for (const [category, types] of Object.entries(MEDIA_CATEGORIES) as [
    MediaCategory,
    readonly MediaType[],
  ][]) {
    if (types.includes(type)) {
      return category;
    }
  }
  // Every MediaType belongs to a category; this is unreachable unless the enum grows.
  throw new Error(`Unmapped media type: ${type}`);
}
