// Run by the scheduled task "TAM Archive Manager" at startup and every 5 minutes (see
// install-startup-task.ps1): starts tam-api and tam-worker when pm2 has not got them (a fresh
// daemon after a reboot) or gave up on them (errored), and rotates their logs. An app someone
// stopped (pm2 stop / npm run prod:stop) stays stopped. Only what it did is logged, to
// ~/.pm2/logs/tam-watchdog.log.
import { appendFileSync, copyFileSync, existsSync, renameSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_NAMES, ourApps, pm2, startApp } from './pm2.mjs';

const LOG = path.join(os.homedir(), '.pm2', 'logs', 'tam-watchdog.log');
const MAX_LOG_BYTES = 20 * 1024 * 1024;
const KEEP_LOGS = 5;

function log(message) {
  try {
    if (existsSync(LOG) && statSync(LOG).size > 1024 * 1024) {
      renameSync(LOG, `${LOG}.1`);
    }
    appendFileSync(LOG, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Logging is best effort.
  }
}

/** Keeps a big log as <log>.1 … <log>.5 and empties it (pm2 keeps writing to the same file). */
function rotate(app) {
  const files = [app.outLog, app.errLog].filter((file) => file && existsSync(file));
  if (!files.some((file) => statSync(file).size > MAX_LOG_BYTES)) {
    return;
  }
  for (const file of files) {
    for (let index = KEEP_LOGS - 1; index >= 1; index -= 1) {
      if (existsSync(`${file}.${index}`)) {
        renameSync(`${file}.${index}`, `${file}.${index + 1}`);
      }
    }
    copyFileSync(file, `${file}.1`);
  }
  pm2(['flush', app.name], { capture: true });
  log(`rotated the logs of ${app.name}`);
}

try {
  const apps = ourApps();
  for (const name of APP_NAMES) {
    const app = apps.get(name);
    if (app === undefined || app.status === 'errored') {
      const ok = startApp(name);
      log(
        `${name} was ${app === undefined ? 'not running' : 'errored'}: ${ok ? 'started' : 'start failed'}`,
      );
    } else {
      rotate(app);
    }
  }
} catch (error) {
  log(`failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
