import pg from 'pg';

/** Runs one statement against the e2e database, as the worker would write it. */
export async function sql<T extends object = Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = new pg.Client({ connectionString: process.env['E2E_DATABASE_URL'] });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}
