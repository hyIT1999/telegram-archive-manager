import type { StatTone } from '../../shared/components/stat-card/stat-card';
import type { StatsDto } from '../../shared/models';

export interface StatDefinition {
  readonly key: keyof StatsDto;
  readonly label: string;
  readonly icon: string;
  readonly format: 'count' | 'bytes';
  readonly tone: StatTone;
  /** Section the card opens, if any. */
  readonly link?: string;
  readonly hint?: string;
}

export interface StatGroup {
  readonly title: string;
  readonly stats: readonly StatDefinition[];
}

/** Dashboard layout: every StatsDto field, grouped the way people read the archive. */
export const STAT_GROUPS: readonly StatGroup[] = [
  {
    title: 'Archive',
    stats: [
      {
        key: 'channels',
        label: 'Channels',
        icon: 'forum',
        format: 'count',
        tone: 'primary',
        link: '/channels',
      },
      {
        key: 'messages',
        label: 'Messages',
        icon: 'chat',
        format: 'count',
        tone: 'primary',
        link: '/messages',
      },
    ],
  },
  {
    title: 'Media',
    stats: [
      {
        key: 'videos',
        label: 'Videos',
        icon: 'movie',
        format: 'count',
        tone: 'secondary',
        link: '/videos',
      },
      {
        key: 'images',
        label: 'Images',
        icon: 'photo_library',
        format: 'count',
        tone: 'secondary',
        link: '/images',
      },
      {
        key: 'documents',
        label: 'Documents',
        icon: 'description',
        format: 'count',
        tone: 'secondary',
        link: '/documents',
      },
      {
        key: 'audio',
        label: 'Audio',
        icon: 'headphones',
        format: 'count',
        tone: 'secondary',
        link: '/audio',
      },
    ],
  },
  {
    title: 'Downloads',
    stats: [
      {
        key: 'storageBytes',
        label: 'Storage',
        icon: 'hard_drive',
        format: 'bytes',
        tone: 'tertiary',
        hint: 'Size of downloaded files',
      },
      {
        key: 'downloaded',
        label: 'Downloaded',
        icon: 'download_done',
        format: 'count',
        tone: 'tertiary',
      },
      {
        key: 'pending',
        label: 'Pending',
        icon: 'schedule',
        format: 'count',
        tone: 'tertiary',
        hint: 'Queued or downloading',
      },
      {
        key: 'failed',
        label: 'Failed',
        icon: 'error',
        format: 'count',
        tone: 'error',
      },
    ],
  },
];
