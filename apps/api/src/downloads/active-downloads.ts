import type { PrismaClient } from '@tam/database';
import {
  type ActiveDownloadDto,
  type DownloadStage,
  MAX_ACTIVE_FILES,
  type MediaType,
} from '@tam/shared';
import { extensionFor, mediaFileName } from '@tam/storage';

/** A file downloading right now (or claimed for it), as the downloads queries select it. */
export interface ActiveDownloadRow {
  id: string;
  filename: string | null;
  mime_type: string | null;
  type: MediaType;
  size: string | null;
  downloaded_bytes: string;
  progress: number;
  stage: DownloadStage | null;
  requested: boolean;
  updated_at: Date;
  telegram_message_id: number;
}

export function toActiveDownloadDto(row: ActiveDownloadRow): ActiveDownloadDto {
  return {
    mediaId: row.id,
    name:
      row.filename ??
      mediaFileName({
        telegramMessageId: row.telegram_message_id,
        extension: extensionFor(row.mime_type, row.type),
      }),
    type: row.type,
    size: row.size === null ? null : Number(row.size),
    downloadedBytes: Number(row.downloaded_bytes),
    progress: row.progress,
    stage: row.stage,
    requested: row.requested,
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * The files each import job downloads right now, in one query: all of them (no more download at
 * once than MAX_ACTIVE_FILES), in a stable order so a page listing them does not jump around.
 */
export async function activeFilesOf(
  prisma: Pick<PrismaClient, '$queryRaw'>,
  importJobIds: readonly string[],
): Promise<Map<string, ActiveDownloadDto[]>> {
  const files = new Map<string, ActiveDownloadDto[]>();
  if (importJobIds.length === 0) {
    return files;
  }
  const rows = await prisma.$queryRaw<(ActiveDownloadRow & { import_job_id: string })[]>`
    SELECT active.* FROM (
      SELECT d.import_job_id, m.id, m.filename, m.mime_type, m.type, m.size::text AS size,
             m.downloaded_bytes::text AS downloaded_bytes, d.progress, d.stage,
             d.requested_at IS NOT NULL AS requested, d.updated_at, g.telegram_message_id,
             row_number() OVER (PARTITION BY d.import_job_id ORDER BY d.id) AS position
      FROM download_jobs d
      JOIN media m ON m.id = d.media_id
      JOIN messages g ON g.id = m.message_id
      WHERE d.import_job_id = ANY(${[...importJobIds]}::uuid[]) AND d.status = 'ACTIVE'
    ) AS active
    WHERE active.position <= ${MAX_ACTIVE_FILES}
    ORDER BY active.import_job_id, active.position`;
  for (const row of rows) {
    const list = files.get(row.import_job_id) ?? [];
    list.push(toActiveDownloadDto(row));
    files.set(row.import_job_id, list);
  }
  return files;
}
