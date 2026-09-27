import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { API_PREFIX, configureApp } from './bootstrap/configure-app.js';
import { createAppLogger } from './bootstrap/logger.js';
import { closeOnShutdownMessage } from './bootstrap/process-shutdown.js';
import { insecureSettingWarnings } from './bootstrap/setting-warnings.js';
import { readEnv, type Env } from './config/env.js';

// Startup logs are buffered until the configured logger is installed (env is validated during create).
const app = await NestFactory.create<NestExpressApplication>(AppModule, {
  bufferLogs: true,
  // Keep-alive connections would otherwise hold app.close() until they time out.
  forceCloseConnections: true,
});
const env = readEnv(app.get<ConfigService<Env, true>>(ConfigService));
const logger = createAppLogger(env);
app.useLogger(logger);
for (const warning of insecureSettingWarnings(env)) {
  logger.warn(warning, 'Bootstrap');
}

configureApp(app, env);
closeOnShutdownMessage(app, logger);

await app.listen(env.API_PORT, env.API_HOST);
logger.log(`Listening on http://${env.API_HOST}:${env.API_PORT}/${API_PREFIX}`, 'Bootstrap');
if (env.WEB_DIST_DIR !== undefined) {
  logger.log(
    `Serving the web app from ${env.WEB_DIST_DIR} on http://${env.API_HOST}:${env.API_PORT}/`,
    'Bootstrap',
  );
}
