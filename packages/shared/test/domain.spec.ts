import { describe, expect, it } from 'vitest';
import { MEDIA_CATEGORIES, MediaType, jobIds, mediaCategoryOf } from '../src/index.js';

describe('media categories', () => {
  it('maps every media type to exactly one sidebar category', () => {
    const all = Object.values(MEDIA_CATEGORIES).flat();
    expect([...all].sort()).toEqual(Object.values(MediaType).sort());
    expect(mediaCategoryOf(MediaType.VIDEO_NOTE)).toBe('videos');
    expect(mediaCategoryOf(MediaType.VOICE)).toBe('audio');
  });
});

describe('jobIds', () => {
  it('builds BullMQ-safe ids (no colon, never all digits)', () => {
    const ids = [
      jobIds.importRun('0199d6b2-7e4a-7c3e-9b1a-2f4c5d6e7f80', 3),
      jobIds.mediaDownload('42', 0),
      jobIds.mediaDownload('0199d6b2-7e4a-7c3e-9b1a-2f4c5d6e7f80', 12),
    ];
    for (const id of ids) {
      expect(id).not.toContain(':');
      expect(/^\d+$/.test(id)).toBe(false);
    }
    expect(ids[0]).toBe('ij-0199d6b2-7e4a-7c3e-9b1a-2f4c5d6e7f80-3');
    expect(ids[2]).toBe('dl-0199d6b2-7e4a-7c3e-9b1a-2f4c5d6e7f80-12');
  });
});
