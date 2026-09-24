/** Message of an unknown thrown value, for log lines. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
