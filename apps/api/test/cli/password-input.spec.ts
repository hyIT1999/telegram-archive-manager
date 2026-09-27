import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  passwordFromStdin,
  promptHidden,
  PromptCancelledError,
  readNewPassword,
  type PromptStreams,
} from '../../src/cli/password-input.js';
import { UsageError } from '../../src/cli/usage-error.js';

/** A terminal: keystrokes go into `input`, whatever is shown lands in `shown`. */
function fakeTerminal(isTTY = true) {
  const input = Object.assign(new PassThrough(), {
    isTTY,
    isRaw: false,
    setRawMode: vi.fn(function (this: { isRaw: boolean }, mode: boolean) {
      this.isRaw = mode;
    }),
  });
  const output = new PassThrough();
  let shown = '';
  output.on('data', (chunk: Buffer) => {
    shown += chunk.toString('utf8');
  });
  const streams: PromptStreams = { input, output };
  return {
    streams,
    input,
    shown: () => shown,
    /** Types keystrokes once the prompt listens (like a person would). */
    type: (...keys: string[]) => {
      setImmediate(() => {
        for (const key of keys) {
          input.write(key);
        }
      });
    },
  };
}

describe('passwordFromStdin', () => {
  it('removes a BOM and exactly one trailing line ending', () => {
    expect(passwordFromStdin('correct horse battery\n')).toBe('correct horse battery');
    expect(passwordFromStdin(String.fromCharCode(0xfeff) + 'correct horse battery\r\n')).toBe(
      'correct horse battery',
    );
    expect(passwordFromStdin(' spaces are kept  \n\n')).toBe(' spaces are kept  \n');
  });

  it('enforces the password policy', () => {
    expect(() => passwordFromStdin('short\n')).toThrow(UsageError);
    expect(() => passwordFromStdin('short\n')).toThrow('Password must be at least 12 characters');
    expect(() => passwordFromStdin('')).toThrow(UsageError);
  });
});

describe('promptHidden', () => {
  it('reads a line without echoing it, then restores the terminal', async () => {
    const terminal = fakeTerminal();
    terminal.type('secret ', 'passphrase', '\r');
    await expect(promptHidden('Password: ', terminal.streams)).resolves.toBe('secret passphrase');
    expect(terminal.shown()).toBe('Password: \n');
    expect(terminal.input.setRawMode.mock.calls).toEqual([[true], [false]]);
  });

  it('handles backspace, ignores arrow keys and control characters', async () => {
    const terminal = fakeTerminal();
    terminal.type('abcd', '\u007f', '\b', '\u001b[D', 'x\u0007y', '\n');
    await expect(promptHidden('Password: ', terminal.streams)).resolves.toBe('abxy');
  });

  it('keeps non-ASCII characters whole, even when deleting', async () => {
    const terminal = fakeTerminal();
    terminal.type('mật khẩu😀', '\u007f', '\r');
    await expect(promptHidden('Password: ', terminal.streams)).resolves.toBe('mật khẩu');
  });

  it('is cancelled by Ctrl+C, and by Ctrl+D on an empty line', async () => {
    const ctrlC = fakeTerminal();
    ctrlC.type('abc', '\u0003');
    await expect(promptHidden('Password: ', ctrlC.streams)).rejects.toBeInstanceOf(
      PromptCancelledError,
    );
    expect(ctrlC.input.setRawMode).toHaveBeenLastCalledWith(false);

    const ctrlD = fakeTerminal();
    ctrlD.type('\u0004');
    await expect(promptHidden('Password: ', ctrlD.streams)).rejects.toBeInstanceOf(
      PromptCancelledError,
    );
  });

  it('needs a terminal', async () => {
    await expect(promptHidden('Password: ', fakeTerminal(false).streams)).rejects.toThrow(
      /--password-stdin/,
    );
  });
});

describe('readNewPassword', () => {
  it('asks twice and returns the password when both match', async () => {
    const terminal = fakeTerminal();
    terminal.type('a long passphrase\r');
    const reading = readNewPassword(terminal.streams);
    await vi.waitFor(() => expect(terminal.shown()).toContain('Repeat the password: '));
    terminal.type('a long passphrase\r');
    await expect(reading).resolves.toBe('a long passphrase');
  });

  it('refuses a short password before asking again, and two different ones', async () => {
    const short = fakeTerminal();
    short.type('short\r');
    await expect(readNewPassword(short.streams)).rejects.toThrow(
      'Password must be at least 12 characters',
    );

    const different = fakeTerminal();
    different.type('a long passphrase\r');
    const reading = readNewPassword(different.streams);
    await vi.waitFor(() => expect(different.shown()).toContain('Repeat the password: '));
    different.type('another passphrase\r');
    await expect(reading).rejects.toThrow('The two passwords do not match');
  });
});
