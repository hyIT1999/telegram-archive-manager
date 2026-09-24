import { TestBed } from '@angular/core/testing';
import { BytesPipe } from './bytes-pipe';

describe('BytesPipe', () => {
  let pipe: BytesPipe;

  beforeEach(() => {
    pipe = TestBed.runInInjectionContext(() => new BytesPipe());
  });

  it.each([
    [0, '0 B'],
    [1, '1 B'],
    [1023, '1,023 B'],
    [1024, '1 KiB'],
    [1536, '1.5 KiB'],
    [1024 ** 2, '1 MiB'],
    [1024 ** 2 - 1, '1 MiB'],
    [734_003_200, '700 MiB'],
    [5 * 1024 ** 3, '5 GiB'],
    [1.25 * 1024 ** 4, '1.3 TiB'],
    [3 * 1024 ** 5, '3 PiB'],
  ])('formats %d bytes as %s', (bytes, expected) => {
    expect(pipe.transform(bytes)).toBe(expected);
  });

  it('honors the number of fraction digits', () => {
    expect(pipe.transform(1_234_567, 2)).toBe('1.18 MiB');
    expect(pipe.transform(1_234_567, 0)).toBe('1 MiB');
  });

  it('keeps the sign of negative values', () => {
    expect(pipe.transform(-2048)).toBe('-2 KiB');
  });

  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY])(
    'renders %s as an em dash',
    (value) => {
      expect(pipe.transform(value)).toBe('—');
    },
  );
});
