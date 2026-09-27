// pm2 process file: production without Docker (the Windows machine the archive runs on).
//   npm run prod:start      (checks first; see scripts/prod/pm2.mjs and README §11)
// Only this project's two apps are listed: pm2 may run other projects' apps in the same daemon, so
// every command names ecosystem.config.cjs or tam-api/tam-worker, never "all".
//
// Everything not set here comes from the .env at the repository root (the apps read it
// themselves; these variables win over it): the same database, Redis, Telegram session and
// storage locations as development.
const path = require('node:path');

/** http://localhost:8080 — only this machine can open it (API_HOST is loopback). */
const HOST = '127.0.0.1';
const PORT = 8080;
const ORIGINS = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];

// pm2 cannot send signals on Windows; the apps close gracefully on its 'shutdown' message.
const shutdownWithMessage = process.platform === 'win32';

module.exports = {
  apps: [
    {
      name: 'tam-api',
      cwd: __dirname,
      script: 'apps/api/dist/main.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      // 1 s, 1.5 s, 2.25 s… up to 15 s between restarts of a crashing app.
      exp_backoff_restart_delay: 1000,
      kill_timeout: 15000,
      shutdown_with_message: shutdownWithMessage,
      max_memory_restart: '800M',
      env: {
        NODE_ENV: 'production',
        API_HOST: HOST,
        API_PORT: String(PORT),
        // No proxy in front: the client address is the connection's own.
        TRUST_PROXY: 'false',
        CSRF_TRUSTED_ORIGINS: ORIGINS.join(','),
        WEB_DIST_DIR: path.join(__dirname, 'apps', 'web', 'dist', 'web', 'browser'),
      },
    },
    {
      name: 'tam-worker',
      cwd: __dirname,
      script: 'apps/worker/dist/main.js',
      // Exactly one: it owns the single Telegram connection.
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      exp_backoff_restart_delay: 2000,
      // Running imports and downloads hand themselves back to the queue before it exits.
      kill_timeout: 70000,
      shutdown_with_message: shutdownWithMessage,
      max_memory_restart: '1200M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
