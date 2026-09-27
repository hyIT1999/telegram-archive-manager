// Runs the archive in production with pm2 (see ecosystem.config.cjs and README §11):
//   node scripts/prod/pm2.mjs start|stop|restart|status|logs|update|enable|disable
// (npm run prod:<command>). Only this project's apps are ever touched: pm2 may run other
// projects' apps in the same daemon, so nothing here says "all", kills the daemon or saves it.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const ECOSYSTEM = path.join(ROOT, 'ecosystem.config.cjs');
export const APP_NAMES = ['tam-api', 'tam-worker'];
export const TASK_NAME = 'TAM Archive Manager';
const isWindows = process.platform === 'win32';

/** pm2's own script, run with this node (works the same from a scheduled task). */
export function findPm2() {
  const candidates = [];
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', 'pm2', 'bin', 'pm2'));
  }
  const npmRoot = spawnSync('npm root -g', { encoding: 'utf8', shell: true });
  if (npmRoot.status === 0) {
    candidates.push(path.join(npmRoot.stdout.trim(), 'pm2', 'bin', 'pm2'));
  }
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error('pm2 is not installed: npm install -g pm2');
  }
  return found;
}

let pm2Bin;

/** Runs pm2; with `capture`, returns its output instead of showing it. */
export function pm2(args, { capture = false } = {}) {
  pm2Bin ??= findPm2();
  const result = spawnSync(process.execPath, [pm2Bin, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    timeout: 120_000,
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? '' };
}

/**
 * This project's apps as pm2 knows them. `pm2 jlist` describes every app of the daemon with its
 * environment, other projects' too: it is read here and never printed or saved.
 */
export function ourApps() {
  const { status, stdout } = pm2(['jlist'], { capture: true });
  if (status !== 0) {
    throw new Error('pm2 jlist failed');
  }
  const start = stdout.indexOf('[');
  const list = start === -1 ? [] : JSON.parse(stdout.slice(start));
  const apps = new Map();
  for (const app of list) {
    if (APP_NAMES.includes(app.name)) {
      apps.set(app.name, {
        name: app.name,
        status: app.pm2_env?.status ?? 'unknown',
        pid: app.pid,
        restarts: app.pm2_env?.restart_time ?? 0,
        uptimeMs: app.pm2_env?.pm_uptime ? Date.now() - app.pm2_env.pm_uptime : 0,
        memory: app.monit?.memory ?? 0,
        outLog: app.pm2_env?.pm_out_log_path,
        errLog: app.pm2_env?.pm_err_log_path,
      });
    }
  }
  return apps;
}

/** Starts (or restarts) one app with the settings of ecosystem.config.cjs. */
export function startApp(name) {
  return pm2(['start', ECOSYSTEM, '--only', name, '--update-env']).status === 0;
}

function portAnswers(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/** Runs a fixed command line (never built from input) through the shell, for npm and npx. */
function run(commandLine, options = {}) {
  const result = spawnSync(commandLine, { cwd: ROOT, stdio: 'inherit', shell: true, ...options });
  return result.status === 0;
}

/** What must hold before production starts; returns the problems found. */
async function preflight() {
  const problems = [];
  for (const file of [
    'apps/api/dist/main.js',
    'apps/worker/dist/main.js',
    'apps/web/dist/web/browser/index.html',
  ]) {
    if (!existsSync(path.join(ROOT, file))) {
      problems.push(`${file} is missing: build first (npm run build)`);
    }
  }
  if (await portAnswers(3100)) {
    problems.push(
      'The development api answers on port 3100: stop `npm run dev` first. Two workers must never run together.',
    );
  }
  const upToDate = run('npx --no-install prisma migrate status', {
    cwd: path.join(ROOT, 'packages', 'database'),
    stdio: 'ignore',
  });
  if (!upToDate) {
    problems.push('The database is not up to date: npm run db:deploy');
  }
  return problems;
}

function formatDuration(ms) {
  const minutes = Math.floor(ms / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function printStatus() {
  const apps = ourApps();
  for (const name of APP_NAMES) {
    const app = apps.get(name);
    console.log(
      app
        ? `${name.padEnd(11)} ${app.status.padEnd(9)} pid ${String(app.pid ?? '-').padEnd(6)} up ${formatDuration(app.uptimeMs).padEnd(10)} restarts ${app.restarts}  ${Math.round(app.memory / 1024 / 1024)} MB`
        : `${name.padEnd(11)} not started`,
    );
  }
}

function task(action) {
  if (!isWindows) {
    console.error('The startup task exists on Windows only (use systemd or Docker elsewhere).');
    return false;
  }
  const result = spawnSync(
    'schtasks',
    ['/Change', '/TN', TASK_NAME, action === 'enable' ? '/ENABLE' : '/DISABLE'],
    { stdio: 'inherit' },
  );
  return result.status === 0;
}

async function main(command) {
  switch (command) {
    case 'start': {
      const problems = await preflight();
      if (problems.length > 0) {
        for (const problem of problems) {
          console.error(`- ${problem}`);
        }
        return 1;
      }
      const apps = ourApps();
      for (const name of APP_NAMES) {
        if (apps.get(name)?.status === 'online') {
          console.log(`${name} is already running.`);
        } else if (!startApp(name)) {
          return 1;
        }
      }
      printStatus();
      console.log('The archive: http://localhost:8080');
      return 0;
    }
    case 'stop':
      return pm2(['stop', ECOSYSTEM]).status;
    case 'restart':
      return pm2(['startOrRestart', ECOSYSTEM, '--update-env']).status;
    case 'status':
      printStatus();
      return 0;
    case 'logs':
      return pm2(['logs', '/^tam-/', '--lines', '100']).status;
    case 'update': {
      // The running apps keep their loaded code until the restart.
      if (!run('npm run build') || !run('npm run db:deploy')) {
        return 1;
      }
      return pm2(['startOrRestart', ECOSYSTEM, '--update-env']).status;
    }
    case 'enable':
    case 'disable':
      return task(command) ? 0 : 1;
    default:
      console.error(
        'Usage: node scripts/prod/pm2.mjs start|stop|restart|status|logs|update|enable|disable',
      );
      return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv[2]);
}
