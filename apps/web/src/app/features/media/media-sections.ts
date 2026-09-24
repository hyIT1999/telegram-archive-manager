import type { MediaCategory } from '../../shared/models';

export interface MediaSection {
  readonly category: MediaCategory;
  readonly title: string;
  readonly icon: string;
  /** What the section lists (mirrors MEDIA_CATEGORIES in @tam/shared). */
  readonly description: string;
}

/** The four media browsers in the sidebar; they share one page, keyed by route data. */
export const MEDIA_SECTIONS: readonly MediaSection[] = [
  {
    category: 'videos',
    title: 'Videos',
    icon: 'movie',
    description: 'Videos, GIF animations and round video messages.',
  },
  {
    category: 'images',
    title: 'Images',
    icon: 'photo_library',
    description: 'Photos and stickers.',
  },
  {
    category: 'documents',
    title: 'Documents',
    icon: 'description',
    description: 'Files shared as documents: PDFs, archives, e-books and more.',
  },
  {
    category: 'audio',
    title: 'Audio',
    icon: 'headphones',
    description: 'Music, audio files and voice messages.',
  },
];

export function mediaSection(category: MediaCategory): MediaSection {
  const section = MEDIA_SECTIONS.find((candidate) => candidate.category === category);
  if (!section) {
    throw new Error(`Unknown media category: ${category}`);
  }
  return section;
}
