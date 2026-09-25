import { durationText, secondsLeft, speedBetween } from './download-labels';

describe('download labels', () => {
  it('tells the speed between two readings of a file', () => {
    expect(speedBetween({ bytes: 0, at: 1_000 }, { bytes: 4 * 1024 ** 2, at: 3_000 })).toBe(
      2 * 1024 ** 2,
    );
    expect(speedBetween(undefined, { bytes: 10, at: 1_000 })).toBeNull();
    expect(speedBetween({ bytes: 10, at: 1_000 }, { bytes: 20, at: 1_000 })).toBeNull();
    // A restarted file (fewer bytes than before) has no speed yet.
    expect(speedBetween({ bytes: 20, at: 1_000 }, { bytes: 10, at: 2_000 })).toBeNull();
  });

  it('estimates the time left, and says when it cannot', () => {
    expect(secondsLeft(10 * 1024 ** 2, 1024 ** 2)).toBe(10);
    expect(secondsLeft(10, null)).toBeNull();
    expect(secondsLeft(10, 0)).toBeNull();
  });

  it('writes durations the way people say them', () => {
    expect(durationText(0.2)).toBe('1 s');
    expect(durationText(45)).toBe('45 s');
    expect(durationText(12 * 60)).toBe('12 min');
    expect(durationText(3 * 3600)).toBe('3 h');
    expect(durationText(3 * 3600 + 20 * 60)).toBe('3 h 20 min');
    expect(durationText(2 * 86_400 + 5 * 3600)).toBe('2 d 5 h');
  });
});
