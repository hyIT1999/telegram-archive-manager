import { TestBed } from '@angular/core/testing';
import { MemoryStorage } from '../../../testing/memory-storage';
import { FeedStateCache } from '../messages/feed-cache';
import { durationLabel, fileKind, viewerKind } from './media-labels';
import { DEFAULT_PREFERENCES, PLAYBACK_STORAGE, PlaybackMemory } from './playback-memory';
import { MAX_SCALE, ZOOM_RESET, panBy, zoomAt, zoomTransform } from './zoom';

describe('media labels', () => {
  it('picks a viewer by MIME type, whatever Telegram calls the file', () => {
    expect(viewerKind('image/jpeg')).toBe('image');
    expect(viewerKind('video/mp4; codecs="avc1"')).toBe('video');
    expect(viewerKind('audio/ogg')).toBe('audio');
    expect(viewerKind('application/pdf')).toBe('pdf');
    expect(viewerKind('application/zip')).toBe('file');
    expect(viewerKind(null)).toBe('file');
  });

  it('writes lengths as m:ss or h:mm:ss', () => {
    expect(durationLabel(5)).toBe('0:05');
    expect(durationLabel(754.6)).toBe('12:35');
    expect(durationLabel(3_723)).toBe('1:02:03');
    expect(durationLabel(null)).toBeNull();
    expect(durationLabel(Number.NaN)).toBeNull();
  });

  it('names files by MIME type or extension', () => {
    expect(fileKind('application/pdf', 'notes.pdf')).toEqual({
      label: 'PDF document',
      icon: 'picture_as_pdf',
    });
    expect(fileKind('application/octet-stream', 'slides.pptx').label).toBe('Presentation');
    expect(
      fileKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', null).label,
    ).toBe('Spreadsheet');
    expect(fileKind(null, 'setup.bin')).toEqual({ label: 'BIN file', icon: 'draft' });
    expect(fileKind(null, null).label).toBe('File');
  });
});

describe('zoom', () => {
  const bounds = { width: 400, height: 300 };

  it('zooms around a point and never below normal size', () => {
    const zoomed = zoomAt(ZOOM_RESET, 2, bounds, { x: 100, y: 50 });
    // The point under the cursor stays where it was: 100 = x + 2 * 100 → x = -100.
    expect(zoomed).toEqual({ scale: 2, x: -100, y: -50 });
    expect(zoomAt(zoomed, 0.1, bounds)).toEqual(ZOOM_RESET);
    expect(zoomAt(ZOOM_RESET, 100, bounds).scale).toBe(MAX_SCALE);
  });

  it('pans a zoomed image only as far as its edges', () => {
    const zoomed = { scale: 2, x: 0, y: 0 };
    expect(panBy(zoomed, 1_000, -1_000, bounds)).toEqual({ scale: 2, x: 200, y: -150 });
    expect(panBy(ZOOM_RESET, 50, 50, bounds)).toEqual(ZOOM_RESET);
    expect(zoomTransform({ scale: 1.5, x: 10, y: -4 })).toBe('translate(10px, -4px) scale(1.5)');
  });
});

describe('PlaybackMemory', () => {
  let storage: MemoryStorage;
  let memory: PlaybackMemory;

  beforeEach(() => {
    storage = new MemoryStorage();
    TestBed.configureTestingModule({
      providers: [{ provide: PLAYBACK_STORAGE, useValue: storage }],
    });
    memory = TestBed.inject(PlaybackMemory);
  });

  const entry = (mediaId: string, position: number, duration = 600) => ({
    mediaId,
    messageId: `message-${mediaId}`,
    title: `Lesson ${mediaId}`,
    kind: 'video' as const,
    position,
    duration,
  });

  it('remembers player settings, with sane defaults', () => {
    expect(memory.preferences()).toEqual(DEFAULT_PREFERENCES);
    memory.savePreferences({ volume: 0.4, muted: true, rate: 1.5 });
    expect(memory.preferences()).toEqual({ volume: 0.4, muted: true, rate: 1.5 });
    storage.setItem('tam.player.preferences', '{"volume": 7, "rate": 99}');
    expect(memory.preferences()).toEqual({ volume: 1, muted: false, rate: 1 });
  });

  it('resumes files left in the middle, not ones barely started or finished', () => {
    memory.remember(entry('a', 120), 1);
    memory.remember(entry('b', 2), 2);
    memory.remember(entry('c', 595), 3);
    expect(memory.position('a')).toBe(120);
    expect(memory.position('b')).toBeNull();
    expect(memory.position('c')).toBeNull();
  });

  it('lists what to continue, most recent first, and forgets finished files', () => {
    memory.remember(entry('a', 60), 1);
    memory.remember(entry('b', 60), 3);
    memory.remember(entry('c', 60), 2);
    expect(memory.continueWatching(2).map((item) => item.mediaId)).toEqual(['b', 'c']);
    memory.forget('b');
    expect(memory.continueWatching().map((item) => item.mediaId)).toEqual(['c', 'a']);
  });

  it('works without storage and ignores damaged data', () => {
    storage.setItem('tam.player.progress', 'not json');
    expect(memory.continueWatching()).toEqual([]);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: PLAYBACK_STORAGE, useValue: null }] });
    const without = TestBed.inject(PlaybackMemory);
    without.remember(entry('a', 60));
    expect(without.position('a')).toBeNull();
  });
});

describe('FeedStateCache', () => {
  const snapshot = { items: [], nextCursor: 'next', total: 3, totalCapped: false };

  it('keeps the last feeds for ten minutes', () => {
    const cache = new FeedStateCache();
    cache.set('a', snapshot, 0);
    expect(cache.get('a', 599_000)).toBe(snapshot);
    expect(cache.get('a', 601_000)).toBeNull();
    cache.set('b', snapshot, 0);
    cache.delete('b');
    expect(cache.get('b', 0)).toBeNull();
  });

  it('drops the least recently saved feed beyond eight', () => {
    const cache = new FeedStateCache();
    for (let index = 0; index < 9; index += 1) {
      cache.set(`feed-${index}`, snapshot, index);
    }
    expect(cache.get('feed-0', 10)).toBeNull();
    expect(cache.get('feed-8', 10)).toBe(snapshot);
  });
});
