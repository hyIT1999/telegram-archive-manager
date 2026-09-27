// Line coverage of every workspace, unit and integration tests together, in one table
// (npm run test:coverage; needs PostgreSQL and Redis like npm run test:integration).
// A workspace below its minimum fails the run: the minimums sit a little under what the tests
// cover today, so coverage cannot drop unnoticed. Only JSON data is written (coverage/ folders,
// ignored by git), never HTML reports.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createCoverageMap } = require('istanbul-lib-coverage');

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/**
 * `runs`: the vitest configs whose tests count (null: the workspace's default, unit tests).
 * `minLines`: the line coverage (%) the workspace must keep.
 */
const WORKSPACES = [
  { dir: 'packages/shared', runs: [null], minLines: 95 },
  { dir: 'packages/crypto', runs: [null], minLines: 97 },
  { dir: 'packages/database', runs: [null, 'vitest.integration.config.ts'], minLines: 52 },
  { dir: 'packages/storage', runs: [null], minLines: 85 },
  { dir: 'packages/telegram', runs: [null], minLines: 81 },
  { dir: 'apps/api', runs: [null, 'vitest.e2e.config.ts'], minLines: 87 },
  { dir: 'apps/worker', runs: [null, 'vitest.integration.config.ts'], minLines: 84 },
  { dir: 'apps/web', angular: true, minLines: 89 },
];

function vitestCommand(config, reportsDirectory) {
  return [
    'npx vitest run',
    config ? `--config ${config}` : '',
    '--coverage.enabled',
    '--coverage.provider=v8',
    '--coverage.reporter=json',
    `--coverage.reportsDirectory=${reportsDirectory}`,
    '--coverage.include=src/**/*.ts',
    '--coverage.exclude=src/generated/**',
    '--coverage.exclude=src/**/*.d.ts',
  ]
    .filter(Boolean)
    .join(' ');
}

function run(dir, command) {
  return (
    spawnSync(command, { cwd: path.join(root, dir), stdio: 'inherit', shell: true }).status === 0
  );
}

const rows = [];
let failed = false;
for (const workspace of WORKSPACES) {
  const coverageDir = path.join(root, workspace.dir, 'coverage');
  rmSync(coverageDir, { recursive: true, force: true });
  const reports = [];
  let ok = true;
  if (workspace.angular) {
    console.log(`\n==> ${workspace.dir}`);
    ok = run(
      workspace.dir,
      "npx ng test --watch=false --coverage --coverage-reporters=json --coverage-exclude='src/testing/**'",
    );
    reports.push(path.join(coverageDir, 'web', 'coverage-final.json'));
  } else {
    for (const [index, config] of workspace.runs.entries()) {
      console.log(`\n==> ${workspace.dir} (${config ?? 'unit tests'})`);
      const reportsDirectory = `coverage/run-${index}`;
      ok = run(workspace.dir, vitestCommand(config, reportsDirectory)) && ok;
      reports.push(path.join(root, workspace.dir, reportsDirectory, 'coverage-final.json'));
    }
  }
  const map = createCoverageMap({});
  for (const report of reports) {
    if (existsSync(report)) {
      map.merge(JSON.parse(readFileSync(report, 'utf8')));
    }
  }
  if (!ok || map.files().length === 0) {
    failed = true;
    rows.push({ ...workspace, error: ok ? 'no coverage data' : 'tests failed' });
    continue;
  }
  const summary = map.getCoverageSummary();
  const row = {
    ...workspace,
    lines: summary.lines.pct,
    statements: summary.statements.pct,
    branches: summary.branches.pct,
    functions: summary.functions.pct,
  };
  failed ||= row.lines < workspace.minLines;
  rows.push(row);
}

console.log(
  '\n| Workspace | Tests | Lines % | Statements % | Branches % | Functions % | Minimum lines % |',
);
console.log('|---|---|---:|---:|---:|---:|---:|');
for (const row of rows) {
  const tests = row.angular ? 'unit' : row.runs.length > 1 ? 'unit + integration' : 'unit';
  console.log(
    row.error
      ? `| ${row.dir} | ${tests} | ${row.error} | | | | ${row.minLines} |`
      : `| ${row.dir} | ${tests} | ${row.lines.toFixed(1)} | ${row.statements.toFixed(1)} | ${row.branches.toFixed(1)} | ${row.functions.toFixed(1)} | ${row.minLines}${row.lines < row.minLines ? ' (below!)' : ''} |`,
  );
}
process.exitCode = failed ? 1 : 0;
