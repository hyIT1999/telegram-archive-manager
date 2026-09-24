/**
 * The job is no longer this run's to work on: it was paused or cancelled, or a newer run took
 * over (resume). Whatever the run was writing is rolled back, and the run ends quietly.
 */
export class ImportInterruptedError extends Error {
  constructor() {
    super('The import job was paused, cancelled or taken over by a newer run');
    this.name = 'ImportInterruptedError';
  }
}

/**
 * The channel's imported range changed between reading a page from Telegram and storing it, so
 * the page may not continue the range any more. The run re-reads the range and fetches again.
 */
export class ArchiveRangeMovedError extends Error {
  constructor() {
    super("The channel's imported range changed while a page was being stored");
    this.name = 'ArchiveRangeMovedError';
  }
}
