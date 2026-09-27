import type { Prisma } from './generated/prisma/client.js';

/** How a download that was running ended (ACTIVE → one of these). */
export type FinishedDownloadStatus = 'COMPLETED' | 'FAILED' | 'SKIPPED';

/**
 * Counts one running file of an import job as finished, without recounting the job's files
 * (a recount reads every file: ~150 ms for 100 000). A running file only counts in total_media
 * and total_bytes, so leaving ACTIVE adds it to exactly one counter. Call it in the transaction
 * that moved the download from ACTIVE, and only then; everything else recounts.
 */
export async function countFinishedFile(
  tx: Prisma.TransactionClient,
  importJobId: string,
  downloadJobId: string,
  status: FinishedDownloadStatus,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE import_jobs AS j
    SET downloaded_files = j.downloaded_files + (${status}::text = 'COMPLETED')::int,
        failed_files = j.failed_files + (${status}::text = 'FAILED')::int,
        skipped_files = j.skipped_files + (${status}::text = 'SKIPPED')::int,
        downloaded_bytes = j.downloaded_bytes
          + CASE WHEN ${status}::text = 'COMPLETED' THEN coalesce(d.size, 0) ELSE 0 END
    FROM download_jobs AS d
    WHERE j.id = ${importJobId}::uuid AND d.id = ${downloadJobId}::uuid`;
}

/**
 * Recomputes an import job's media counters from its download jobs, so a repeated page, a retried
 * download or a changed setting can never count twice. The worker (import pages) and the api
 * (settings, retries, cancels) recount; only a single download ending uses countFinishedFile.
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
