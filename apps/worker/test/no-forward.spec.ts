import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Every TypeScript source file under `folder`. */
async function sources(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

describe('Telegram backups never forward', () => {
  it('no code of the Telegram adapter or the worker forwards or copies messages', async () => {
    const files = [
      ...(await sources(path.join(REPO, 'packages', 'telegram', 'src'))),
      ...(await sources(path.join(REPO, 'apps', 'worker', 'src'))),
    ];
    expect(files.length).toBeGreaterThan(20);
    const offenders: string[] = [];
    for (const file of files) {
      const code = await readFile(file, 'utf8');
      // Forwards (with or without the author) and mtcute's copy helpers, which re-send the
      // original file: a backup always uploads the file again.
      if (/\bforwardMessages\b|messages\.forwardMessages|\bsendCopy(Group)?\b/.test(code)) {
        offenders.push(path.relative(REPO, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
