import { type Prisma, refreshMediaCountersOf } from '@tam/database';
import type { PrismaService } from '@tam/database/nest';
import { DOWNLOAD_SETTINGS_KEY, type DownloadSettings, readDownloadSettings } from '@tam/shared';

const MIB = 1024n * 1024n;

/** The download settings as stored (app_settings "downloads"), with defaults for what is missing. */
export async function loadDownloadSettings(
  prisma: PrismaService | Prisma.TransactionClient,
): Promise<DownloadSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: DOWNLOAD_SETTINGS_KEY } });
  return readDownloadSettings(row?.value);
}

interface ChangedRow {
  media_id: string;
  import_job_id: string | null;
}

/**
 * Applies the automatic download settings to files not downloaded yet: files they now allow go
 * back in line, and waiting files they no longer allow are skipped (reason POLICY) unless someone
 * asked for them. Running downloads finish.
 */
export async function applyDownloadPolicy(
  tx: Prisma.TransactionClient,
  settings: Pick<DownloadSettings, 'mediaTypes' | 'maxFileSizeMb'>,
): Promise<void> {
  const types = settings.mediaTypes as string[];
  const maxBytes = settings.maxFileSizeMb === null ? null : BigInt(settings.maxFileSizeMb) * MIB;
  const allowed = await tx.$queryRaw<ChangedRow[]>`
    UPDATE download_jobs d
    SET status = 'PENDING', reason = NULL, error = NULL, not_before = NULL, updated_at = now()
    FROM media m
    WHERE d.media_id = m.id AND d.status = 'SKIPPED' AND d.reason = 'POLICY'
      AND m.type::text = ANY(${types}::text[])
      AND (${maxBytes}::bigint IS NULL OR m.size IS NULL OR m.size <= ${maxBytes}::bigint)
    RETURNING d.media_id, d.import_job_id`;
  const skipped = await tx.$queryRaw<ChangedRow[]>`
    UPDATE download_jobs d
    SET status = 'SKIPPED', reason = 'POLICY', error = NULL, not_before = NULL, updated_at = now()
    FROM media m
    WHERE d.media_id = m.id AND d.status = 'PENDING' AND d.requested_at IS NULL
      AND NOT (
        m.type::text = ANY(${types}::text[])
        AND (${maxBytes}::bigint IS NULL OR m.size IS NULL OR m.size <= ${maxBytes}::bigint)
      )
    RETURNING d.media_id, d.import_job_id`;
  if (allowed.length > 0) {
    await tx.$executeRaw`
      UPDATE media SET download_status = 'PENDING', error = NULL, updated_at = now()
      WHERE id = ANY(${allowed.map((row) => row.media_id)}::uuid[])`;
  }
  if (skipped.length > 0) {
    await tx.$executeRaw`
      UPDATE media SET download_status = 'SKIPPED', error = NULL, updated_at = now()
      WHERE id = ANY(${skipped.map((row) => row.media_id)}::uuid[])`;
  }
  await refreshMediaCountersOf(
    tx,
    [...allowed, ...skipped].map((row) => row.import_job_id),
  );
}

/**
 * Takes running downloads away from the worker (ACTIVE → PENDING): every one, or the ones of
 * some channels that nobody asked for. The worker notices at its next progress write, stops, and
 * keeps the partial file for later.
 */
export async function stopRunningDownloads(
  tx: Prisma.TransactionClient,
  channelIds?: readonly string[],
): Promise<number> {
  const stopped =
    channelIds === undefined
      ? await tx.$queryRaw<{ media_id: string }[]>`
          UPDATE download_jobs SET status = 'PENDING', stage = NULL, updated_at = now()
          WHERE status = 'ACTIVE'
          RETURNING media_id`
      : await tx.$queryRaw<{ media_id: string }[]>`
          UPDATE download_jobs d SET status = 'PENDING', stage = NULL, updated_at = now()
          WHERE d.status = 'ACTIVE' AND d.requested_at IS NULL
            AND d.channel_id = ANY(${[...channelIds]}::uuid[])
          RETURNING d.media_id`;
  if (stopped.length > 0) {
    await tx.$executeRaw`
      UPDATE media SET download_status = 'PENDING', updated_at = now()
      WHERE id = ANY(${stopped.map((row) => row.media_id)}::uuid[]) AND download_status = 'DOWNLOADING'`;
  }
  return stopped.length;
}
