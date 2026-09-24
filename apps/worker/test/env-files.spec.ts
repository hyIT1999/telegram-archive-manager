import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultEnvFiles, loadEnvFiles } from '../src/config/env-files.js';

describe('defaultEnvFiles', () => {
  it('reads the working directory first, then the repository root two levels up', () => {
    const cwd = path.resolve('/repo/apps/worker');
    expect(defaultEnvFiles(cwd)).toEqual([
      path.resolve('/repo/apps/worker/.env'),
      path.resolve('/repo/.env'),
    ]);
  });
});

describe('loadEnvFiles', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'tam-worker-env-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function envFile(name: string, content: string): string {
    const file = path.join(dir, name);
    writeFileSync(file, content);
    return file;
  }

  it('keeps variables that are already set and lets earlier files win', () => {
    const local = envFile('local.env', 'A=local\nB=local\n');
    const root = envFile('root.env', 'B=root\nC=root\n# comment\nD="quoted value"\n');
    const target: Record<string, string | undefined> = { A: 'real' };

    const loaded = loadEnvFiles([local, path.join(dir, 'missing.env'), root], target);

    expect(loaded).toEqual([local, root]);
    expect(target).toEqual({ A: 'real', B: 'local', C: 'root', D: 'quoted value' });
  });

  it('keeps an empty value so validation can treat it as unset', () => {
    const target: Record<string, string | undefined> = {};
    loadEnvFiles([envFile('blank.env', 'TELEGRAM_API_ID=\n')], target);
    expect(target).toEqual({ TELEGRAM_API_ID: '' });
  });
});
