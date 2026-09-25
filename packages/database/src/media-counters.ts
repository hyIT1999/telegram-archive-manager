import type { Prisma } from './generated/prisma/client.js';

/**
 * Recomputes an import job's media counters from its download jobs. They are never incremented,
 * so a repeated page, a retried download or a changed setting can never count twice. The worker
 * (imports, downloads) and the api (settings, retries) both keep them current.
 */
export async function refreshMediaCounters(
  tx: Prisma.TransactionClient,
  importJobId: string,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE import_jobs AS j
    SET total_media = c.total,
        downloaded_files = c.downloaded,
        failed_files = c.failed,
        skipped_files = c.skipped,
        total_bytes = c.total_bytes,
        downloaded_bytes = c.downloaded_bytes
    FROM (
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE d.status = 'COMPLETED')::int AS downloaded,
             count(*) FILTER (WHERE d.status = 'FAILED')::int AS failed,
             count(*) FILTER (WHERE d.status = 'SKIPPED')::int AS skipped,
             coalesce(sum(m.size), 0)::bigint AS total_bytes,
             coalesce(sum(m.size) FILTER (WHERE d.status = 'COMPLETED'), 0)::bigint AS downloaded_bytes
      FROM download_jobs d
      JOIN media m ON m.id = d.media_id
      WHERE d.import_job_id = ${importJobId}::uuid
    ) AS c
    WHERE j.id = ${importJobId}::uuid`;
}

/** Recomputes the counters of every import job in `importJobIds` (duplicates and nulls ignored). */
export async function refreshMediaCountersOf(
  tx: Prisma.TransactionClient,
  importJobIds: Iterable<string | null>,
): Promise<void> {
  for (const importJobId of new Set([...importJobIds].filter((id): id is string => id !== null))) {
    await refreshMediaCounters(tx, importJobId);
  }
}
