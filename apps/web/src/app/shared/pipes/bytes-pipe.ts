import { formatNumber } from '@angular/common';
import { LOCALE_ID, Pipe, type PipeTransform, inject } from '@angular/core';

const BINARY_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'] as const;
const STEP = 1024;

/**
 * Formats a byte count with binary (IEC) units: 1536 → "1.5 KiB", 5368709120 → "5 GiB".
 * `null`/`undefined`/non-finite values render as an em dash.
 */
@Pipe({ name: 'bytes' })
export class BytesPipe implements PipeTransform {
  private readonly locale = inject(LOCALE_ID);

  transform(value: number | null | undefined, maxFractionDigits = 1): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return '—';
    }
    const sign = value < 0 ? '-' : '';
    let amount = Math.abs(value);
    let unit = 0;
    while (amount >= STEP && unit < BINARY_UNITS.length - 1) {
      amount /= STEP;
      unit += 1;
    }
    const digits = unit === 0 ? 0 : Math.max(0, Math.trunc(maxFractionDigits));
    // Rounding may reach the next unit (1023.96 KiB → "1024 KiB"); show "1 MiB" instead.
    if (unit < BINARY_UNITS.length - 1 && Number(amount.toFixed(digits)) >= STEP) {
      amount /= STEP;
      unit += 1;
    }
    const formatted = formatNumber(amount, this.locale, `1.0-${unit === 0 ? 0 : digits}`);
    return `${sign}${formatted} ${BINARY_UNITS[unit]}`;
  }
}
