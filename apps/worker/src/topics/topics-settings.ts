/** TopicsSettings for the forum topic refresher. */
export const TOPICS_SETTINGS = Symbol('TOPICS_SETTINGS');

export interface TopicsSettings {
  /** How often the refresher looks for forums whose topics are due; null = never (tests). */
  checkIntervalMs: number | null;
  /** Topic names are read again after this long (renames, new topics between imports). */
  maxAgeMs: number;
  /** A forum whose topics could not be read waits this long before the next try. */
  retryAfterFailureMs: number;
  /** Forums read per round. */
  batchSize: number;
}

export const DEFAULT_TOPICS_SETTINGS: TopicsSettings = {
  checkIntervalMs: 60_000,
  maxAgeMs: 24 * 3_600_000,
  retryAfterFailureMs: 30 * 60_000,
  batchSize: 10,
};
