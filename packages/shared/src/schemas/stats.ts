/** Dashboard totals (GET /api/stats). storageBytes = sum of sizes of DOWNLOADED media. */
export interface StatsDto {
  channels: number;
  messages: number;
  videos: number;
  images: number;
  documents: number;
  audio: number;
  storageBytes: number;
  downloaded: number;
  /** PENDING + DOWNLOADING media. */
  pending: number;
  failed: number;
}

export const STATS_KEYS = [
  'channels',
  'messages',
  'videos',
  'images',
  'documents',
  'audio',
  'storageBytes',
  'downloaded',
  'pending',
  'failed',
] as const satisfies readonly (keyof StatsDto)[];
