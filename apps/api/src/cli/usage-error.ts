/** Bad invocation or input; the CLI prints the message (and usage) and exits with code 2. */
export class UsageError extends Error {
  override readonly name = 'UsageError';
}
