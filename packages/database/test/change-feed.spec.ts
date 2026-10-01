import { describe, expect, it } from 'vitest';
import { parseChange } from '../src/change-feed.js';

describe('change payloads', () => {
  const id = '0192f5a4-7c1e-7d2a-9b3c-4d5e6f708192';

  it('reads the payloads the triggers send', () => {
    expect(parseChange(`job:${id}`)).toEqual({ kind: 'job', id });
    expect(parseChange(`channel:${id}`)).toEqual({ kind: 'channel', id });
    expect(parseChange(`downloads:${id}`)).toEqual({ kind: 'downloads', id });
    expect(parseChange(`backups:${id}`)).toEqual({ kind: 'backups', id });
  });

  it('ignores anything else', () => {
    expect(parseChange(undefined)).toBeNull();
    expect(parseChange('')).toBeNull();
    expect(parseChange(`media:${id}`)).toBeNull();
    expect(parseChange('job:not-a-uuid')).toBeNull();
    expect(parseChange(`job:${id} and more`)).toBeNull();
  });
});
