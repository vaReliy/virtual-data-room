import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';

import { AppModule } from './app.module';
import type { Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Everything lives under /api, because the browser reaches this service through a
  // single-origin rewrite from the SPA (decision #10) and locally through Vite's proxy.
  app.setGlobalPrefix('api');
  app.use(cookieParser());

  // No global ValidationPipe: Nest's pipe is built on class-validator, and request
  // shapes here come from the Zod schemas in packages/contracts (decision #12). The Zod
  // pipe arrives with the first endpoint that accepts a body — nothing in this phase does.

  // No CORS configuration on purpose: one origin means no preflight and no exceptions
  // to keep in sync between local, preview and production.

  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });

  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`API listening on port ${port}`);
}

void bootstrap();
