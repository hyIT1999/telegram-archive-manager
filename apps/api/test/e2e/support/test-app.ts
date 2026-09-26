import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module.js';
import { configureApp } from '../../../src/bootstrap/configure-app.js';
import { readEnv, type Env } from '../../../src/config/env.js';

/** The real AppModule with the same HTTP setup as main.ts; `customize` may override providers. */
export async function createTestApp(
  customize: (builder: TestingModuleBuilder) => TestingModuleBuilder = (builder) => builder,
): Promise<NestExpressApplication> {
  const moduleRef = await customize(Test.createTestingModule({ imports: [AppModule] })).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: ['fatal', 'error'],
    // Like main.ts: open live update streams must not keep close() waiting.
    forceCloseConnections: true,
  });
  configureApp(app, readEnv(app.get<ConfigService<Env, true>>(ConfigService)));
  await app.init();
  return app;
}
