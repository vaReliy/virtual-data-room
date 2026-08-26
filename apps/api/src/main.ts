import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

import { AppModule } from './app.module';
import type { Env } from './config/env';

async function bootstrap(): Promise<void> {
  // Typed as the Express application rather than the platform-agnostic one, for
  // `app.set` below. Nothing else here needs it, and nothing else should reach for it.
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

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

  /**
   * **`req.ip` is a lie until this is set**, and exactly one thing reads it: the anonymous
   * rate limit on `/api/s/:token`, the only route in this system with no session to key on.
   * Behind the Vercel rewrite and Cloud Run, an untrusted chain makes `req.ip` the proxy's
   * address for every caller, so a per-IP bucket becomes one shared bucket for the whole
   * deployment — a limit that works, counts, and is wrong.
   *
   * The number is a **deployment fact, not a default**: trusting more hops than actually
   * sit in front of the service lets a caller spoof `X-Forwarded-For` and walk past the
   * limit. `ClientIpThrottlerGuard` logs the first anonymous request's `req.ip` and raw
   * header once per process, which is how the value is observed rather than guessed.
   *
   * Do not remove this line to "simplify bootstrap". Nothing will fail; the limit will
   * simply stop being per-caller.
   */
  const trustProxyHops = config.get('TRUST_PROXY_HOPS', { infer: true });
  app.set('trust proxy', trustProxyHops);

  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`API listening on port ${port} (trust proxy: ${trustProxyHops})`);
}

void bootstrap();
