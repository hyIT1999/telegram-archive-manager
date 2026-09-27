import { newPasswordSchema } from '@tam/shared';
import { UsageError } from './usage-error.js';

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);
const ENTER = new Set(['\r', '\n']);
const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const BACKSPACE = new Set(['\u007f', '\b']);
const ESCAPE = '\u001b';

/** The terminal the password is typed into (process.stdin/stdout, or fakes in tests). */
export interface PromptStreams {
  input: NodeJS.ReadableStream & {
    isTTY?: boolean;
    isRaw?: boolean;
    setRawMode?: (mode: boolean) => unknown;
  };
  output: NodeJS.WritableStream;
}

/** Ctrl+C (or Ctrl+D on an empty line) while a password was asked for. */
export class PromptCancelledError extends Error {
  override readonly name = 'PromptCancelledError';

  constructor() {
    super('Cancelled');
  }
}

/** Checks a password against the policy (at least 12 characters), as a usage error. */
function checkNewPassword(password: string): string {
  const checked = newPasswordSchema.safeParse(password);
  if (!checked.success) {
    throw new UsageError(checked.error.issues.map((issue) => issue.message).join('; '));
  }
  return checked.data;
}

/** Strips a UTF-8 BOM and the single line ending that `echo` or a pipe appends. */
export function passwordFromStdin(raw: string): string {
  const withoutBom = raw.startsWith(BYTE_ORDER_MARK) ? raw.slice(1) : raw;
  return checkNewPassword(withoutBom.replace(/\r?\n$/, ''));
}

export async function readStdin(input: NodeJS.ReadableStream = process.stdin): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Asks for a secret on a terminal without showing what is typed (raw mode, like sudo): Enter
 * finishes, Backspace deletes, Ctrl+C cancels, arrow keys and other escape sequences are ignored.
 * Works in PowerShell, cmd, Linux terminals and `docker compose exec`.
 */
export function promptHidden(
  question: string,
  streams: PromptStreams = { input: process.stdin, output: process.stdout },
): Promise<string> {
  const { input, output } = streams;
  if (!input.isTTY || !input.setRawMode) {
    return Promise.reject(
      new UsageError('No terminal to ask for the password: pipe it in with --password-stdin'),
    );
  }
  const setRawMode = input.setRawMode.bind(input);
  const wasRaw = input.isRaw === true;
  output.write(question);
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      input.removeListener('data', onData);
      setRawMode(wasRaw);
      input.pause();
      output.write('\n');
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };
    const onData = (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (text.startsWith(ESCAPE)) {
        return;
      }
      for (const char of text) {
        if (ENTER.has(char)) {
          finish();
          return;
        }
        if (char === CTRL_C || (char === CTRL_D && value === '')) {
          finish(new PromptCancelledError());
          return;
        }
        if (BACKSPACE.has(char)) {
          value = [...value].slice(0, -1).join('');
        } else if (char >= ' ') {
          value += char;
        }
      }
    };
    setRawMode(true);
    input.on('data', onData);
    input.resume();
  });
}

/** Asks for a new password twice on the terminal; both must match and follow the policy. */
export async function readNewPassword(streams?: PromptStreams): Promise<string> {
  const password = checkNewPassword(await promptHidden('New password (not shown): ', streams));
  const repeated = await promptHidden('Repeat the password: ', streams);
  if (repeated !== password) {
    throw new UsageError('The two passwords do not match');
  }
  return password;
}

/** The new password: from stdin with --password-stdin, otherwise asked on the terminal. */
export async function readPassword(fromStdin: boolean): Promise<string> {
  if (!fromStdin) {
    return readNewPassword();
  }
  if (process.stdin.isTTY) {
    throw new UsageError(
      'No password on stdin: pipe it into the command, or leave out --password-stdin to type it',
    );
  }
  return passwordFromStdin(await readStdin());
}
