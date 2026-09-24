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
      jobIds.mediaDownload('42'),
      jobIds.thumbnail('42'),
      jobIds.metadata('42'),
    ];
    for (const id of ids) {
      expect(id).not.toContain(':');
      expect(/^\d+$/.test(id)).toBe(false);
    }
    expect(ids[0]).toBe('ij-0199d6b2-7e4a-7c3e-9b1a-2f4c5d6e7f80-3');
  });
});
