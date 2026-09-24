import { describe, expect, it } from 'vitest';
import { databaseNameOf, withDatabaseName } from '../src/admin.js';

describe('database url helpers', () => {
  const url = 'postgresql://tam:p%40ss@localhost:5432/tam?application_name=x';

  it('swaps the database name and keeps credentials and params', () => {
    const swapped = withDatabaseName(url, 'tam_test_db');
    expect(swapped).toBe('postgresql://tam:p%40ss@localhost:5432/tam_test_db?application_name=x');
    expect(databaseNameOf(swapped)).toBe('tam_test_db');
  });

  it('refuses database names that would need quoting', () => {
    expect(() => databaseNameOf('postgresql://u@h/evil%22name')).toThrow();
    expect(() => databaseNameOf('postgresql://u@h/')).toThrow();
  });
});
