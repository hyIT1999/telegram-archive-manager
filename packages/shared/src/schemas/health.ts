export type ComponentStatus = 'up' | 'down';

export interface HealthLiveDto {
  status: 'ok';
}

export interface HealthReadyDto {
  status: 'ok' | 'error';
  checks: {
    database: ComponentStatus;
    redis: ComponentStatus;
  };
  /** Informational only — a restarting worker must not make the api unready. */
  worker: {
    status: 'alive' | 'missing';
    lastSeenAt: string | null;
  };
}
