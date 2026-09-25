import { describe, expect, it } from 'vitest';
import { formatBytes, withSuffix } from '../src/media/media-downloader.js';
import { SpaceGuard, isShortage } from '../src/media/space-guard.js';
import { TelegramCooldown } from '../src/telegram/telegram-cooldown.js';

const GIB = 1024 ** 3;

describe('SpaceGuard', () => {
  it('counts the space running downloads still need, and gives it back', () => {
    const guard = new SpaceGuard();
    const need = { key: 'location:a', freeBytes: 10 * GIB, bytes: 4 * GIB, keepFree: 2 * GIB };

    const first = guard.reserve([need]);
    expect(isShortage(first)).toBe(false);
    const second = guard.reserve([need]);
    // 10 GiB free − 4 GiB set aside − 2 GiB kept free leaves 4 GiB: exactly enough.
    expect(isShortage(second)).toBe(false);
    const third = guard.reserve([need]);
    expect(isShortage(third) && third.available).toBe(0);

    if (!isShortage(first)) {
      first.release();
      first.release();
    }
    expect(isShortage(guard.reserve([need]))).toBe(false);
  });

  it('reserves every need or none, and never refuses unknown space', () => {
    const guard = new SpaceGuard();
    const staging = { key: 'dir:/staging', freeBytes: 5 * GIB, bytes: GIB, keepFree: 0 };
    const drive = { key: 'location:drive', freeBytes: GIB / 2, bytes: GIB, keepFree: 0 };
    const refused = guard.reserve([staging, drive]);
    expect(isShortage(refused) && refused.need.key).toBe('location:drive');
    // The staging folder was not charged for the refused file.
    expect(isShortage(guard.reserve([{ ...staging, bytes: 5 * GIB }]))).toBe(false);
    expect(isShortage(guard.reserve([{ ...drive, freeBytes: null, bytes: 100 * GIB }]))).toBe(
      false,
    );
  });
});

describe('file names', () => {
  it('gives a second file of one message its own name', () => {
    expect(withSuffix('Lessons (-100)/2026-01/42 - lesson.mp4', 'AgADsQQABgZZZ9')).toBe(
      'Lessons (-100)/2026-01/42 - lesson-BgZZZ9.mp4',
    );
    expect(withSuffix('Lessons (-100)/2026-01/42', 'abc')).toBe('Lessons (-100)/2026-01/42-abc');
  });

  it('writes sizes the way people read them', () => {
    expect(formatBytes(5 * 1024 ** 2)).toBe('5 MiB');
    expect(formatBytes(2_048)).toBe('2 KiB');
    expect(formatBytes(1.5 * GIB)).toBe('1.5 GiB');
  });
});

describe('TelegramCooldown', () => {
  it('keeps the latest end of a wait', () => {
    let now = 1_000;
    const cooldown = new TelegramCooldown(() => now);
    expect(cooldown.remainingMs()).toBe(0);
    cooldown.note(30);
    cooldown.note(5);
    expect(cooldown.remainingMs()).toBe(30_000);
    now += 31_000;
    expect(cooldown.remainingMs()).toBe(0);
  });
});
