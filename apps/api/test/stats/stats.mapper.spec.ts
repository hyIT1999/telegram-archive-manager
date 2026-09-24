import { STATS_KEYS } from '@tam/shared';
import { describe, expect, it } from 'vitest';
import { toStatsDto } from '../../src/stats/stats.mapper.js';

describe('toStatsDto', () => {
  it('reports every STATS_KEYS entry as 0 for an empty archive', () => {
    const stats = toStatsDto({ channels: 0, messages: 0, mediaByType: [], mediaByStatus: [] });
    expect(Object.keys(stats).sort()).toEqual([...STATS_KEYS].sort());
    expect(Object.values(stats).every((value) => value === 0)).toBe(true);
  });

  it('groups media types into the sidebar categories', () => {
    const stats = toStatsDto({
      channels: 2,
      messages: 40,
      mediaByType: [
        { type: 'VIDEO', count: 3 },
        { type: 'ANIMATION', count: 2 },
        { type: 'VIDEO_NOTE', count: 1 },
        { type: 'PHOTO', count: 10 },
        { type: 'STICKER', count: 4 },
        { type: 'DOCUMENT', count: 5 },
        { type: 'AUDIO', count: 6 },
        { type: 'VOICE', count: 7 },
      ],
      mediaByStatus: [],
    });
    expect(stats).toMatchObject({
      channels: 2,
      messages: 40,
      videos: 6,
      images: 14,
      documents: 5,
      audio: 13,
    });
  });

  it('counts pending as PENDING + DOWNLOADING and storage from DOWNLOADED media only', () => {
    const stats = toStatsDto({
      channels: 1,
      messages: 1,
      mediaByType: [],
      mediaByStatus: [
        { status: 'PENDING', count: 4, bytes: 400n },
        { status: 'DOWNLOADING', count: 1, bytes: 9_000n },
        { status: 'DOWNLOADED', count: 3, bytes: 5_000_000_000n },
        { status: 'FAILED', count: 2, bytes: 10n },
        { status: 'SKIPPED', count: 8, bytes: 0n },
      ],
    });
    expect(stats).toMatchObject({
      storageBytes: 5_000_000_000,
      downloaded: 3,
      pending: 5,
      failed: 2,
    });
  });
});
