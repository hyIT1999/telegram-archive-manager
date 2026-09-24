import { makeImportJob } from '../../../testing/fixtures';
import {
  canPause,
  canResume,
  importChoiceProblem,
  isMoving,
  isUnfinished,
  localDayStart,
  progressPercent,
  toImportRequest,
  todayInputValue,
} from './import-labels';

describe('import labels', () => {
  it('tells unfinished, moving, pausable and resumable jobs apart', () => {
    const running = makeImportJob({ status: 'RUNNING' });
    const paused = makeImportJob({ status: 'PAUSED' });
    const done = makeImportJob({ status: 'COMPLETED' });
    expect([running, paused, done].map(isUnfinished)).toEqual([true, true, false]);
    expect([running, paused, done].map(isMoving)).toEqual([true, false, false]);
    expect([running, paused, done].map(canPause)).toEqual([true, false, false]);
    expect([running, paused, done].map(canResume)).toEqual([false, true, false]);
  });

  it('computes progress from the expected total, never 100 % before the end', () => {
    expect(progressPercent(makeImportJob({ processedMessages: 120, totalMessages: 500 }))).toBe(24);
    expect(progressPercent(makeImportJob({ processedMessages: 530, totalMessages: 500 }))).toBe(99);
    expect(progressPercent(makeImportJob({ totalMessages: null }))).toBeNull();
    expect(progressPercent(makeImportJob({ totalMessages: 0, processedMessages: 0 }))).toBeNull();
    expect(progressPercent(makeImportJob({ status: 'COMPLETED', totalMessages: 0 }))).toBe(100);
  });

  it('turns a picked day into the moment it starts in the local time zone', () => {
    const start = localDayStart('2026-09-01');
    expect(start?.getFullYear()).toBe(2026);
    expect(start?.getMonth()).toBe(8);
    expect(start?.getDate()).toBe(1);
    expect(start?.getHours()).toBe(0);
    expect(localDayStart('')).toBeNull();
    expect(localDayStart('2026-13-45')).toBeNull();
    expect(todayInputValue(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });

  it('builds the request and explains incomplete choices', () => {
    const now = new Date(2026, 8, 24, 12, 0);
    expect(importChoiceProblem({ mode: 'ALL', fromDay: '' }, now)).toBeNull();
    expect(toImportRequest({ mode: 'ALL', fromDay: '2026-09-01' })).toEqual({ mode: 'ALL' });

    expect(importChoiceProblem({ mode: 'FROM_DATE', fromDay: '' }, now)).toBe(
      'Pick the first day to import.',
    );
    expect(importChoiceProblem({ mode: 'FROM_DATE', fromDay: '2026-09-25' }, now)).toBe(
      'Pick a day that is not in the future.',
    );
    expect(importChoiceProblem({ mode: 'FROM_DATE', fromDay: '2026-09-24' }, now)).toBeNull();
    expect(toImportRequest({ mode: 'FROM_DATE', fromDay: '2026-09-01' })).toEqual({
      mode: 'FROM_DATE',
      fromDate: new Date(2026, 8, 1).toISOString(),
    });
    expect(toImportRequest({ mode: 'FROM_DATE', fromDay: '' })).toBeNull();
  });
});
