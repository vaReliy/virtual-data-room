import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Module,
  UseGuards,
} from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SkipThrottle, ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ClientIpThrottlerGuard } from './client-ip-throttler.guard';
import { SessionThrottlerGuard } from './session-throttler.guard';
import { PRESIGN_THROTTLER, PUBLIC_SHARE_THROTTLER, throttlerConfig } from './throttler.config';

/**
 * **An experiment kept as a test**, because the question it answers is one the brief for
 * this work refused to let anybody predict: what happens when two feature modules each
 * register `ThrottlerModule.forRoot`, and what a `ThrottlerGuard` does with an options
 * array holding more than one named bucket.
 *
 * Both answers are counter-intuitive, and both fail *silently* — a limit that still
 * responds, still counts, and guards the wrong thing:
 *
 * 1. `ThrottlerModule` is `@Global()` and `forRoot` provides `THROTTLER_OPTIONS`. Two
 *    different arrays would be two providers for one global token, so one module's guard
 *    would end up enforcing the other module's limits. That is why `FileModule` and
 *    `ShareModule` are handed the **same** array.
 * 2. A guard enforces **every** named bucket in the options, not the one its `getTracker`
 *    was written for. Hence a `@SkipThrottle` for the foreign bucket on each controller —
 *    without which an anonymous share visitor would spend the upload allowance, tracked by
 *    a guard that throws when there is no session.
 *
 * The two stub controllers below carry exactly the decorators the real ones do. What is
 * being checked is the wiring, so they hold no logic of their own.
 */

/** Stands in for `JwtAuthGuard`: `SessionThrottlerGuard` throws without a `req.user`. */
@Injectable()
class StubSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    request.user = { userId: 'user-1', email: 'user@example.com', issuedAt: 0 };
    return true;
  }
}

@Controller('presign-like')
@UseGuards(StubSessionGuard, SessionThrottlerGuard)
@SkipThrottle({ [PUBLIC_SHARE_THROTTLER]: true })
class PresignLikeController {
  @Get()
  ok(): string {
    return 'ok';
  }
}

@Controller('public-like')
@UseGuards(ClientIpThrottlerGuard)
@SkipThrottle({ [PRESIGN_THROTTLER]: true })
class PublicLikeController {
  @Get()
  ok(): string {
    return 'ok';
  }
}

@Module({
  imports: [ThrottlerModule.forRoot(throttlerConfig)],
  controllers: [PresignLikeController],
  providers: [SessionThrottlerGuard, StubSessionGuard],
})
class PresignLikeModule {}

@Module({
  imports: [ThrottlerModule.forRoot(throttlerConfig)],
  controllers: [PublicLikeController],
  providers: [ClientIpThrottlerGuard],
})
class PublicLikeModule {}

describe('two modules registering ThrottlerModule.forRoot', () => {
  let app: INestApplication;
  let origin: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PresignLikeModule, PublicLikeModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
    origin = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  async function statusesFor(path: string, times: number): Promise<number[]> {
    const statuses: number[] = [];
    for (let index = 0; index < times; index += 1) {
      const response = await fetch(`${origin}${path}`);
      statuses.push(response.status);
    }
    return statuses;
  }

  it('gives each bucket its own count, and neither controller spends the other', async () => {
    const presignLimit = 20;
    const publicLimit = 30;

    const presign = await statusesFor('/presign-like', presignLimit + 1);
    expect(presign.slice(0, presignLimit)).toEqual(Array<number>(presignLimit).fill(200));
    expect(presign.at(-1)).toBe(429);

    // The share bucket is untouched by the twenty-one calls above — the whole point of the
    // `@SkipThrottle`, and the thing that would silently be false if the two `forRoot`
    // calls had produced two competing options providers.
    const share = await statusesFor('/public-like', publicLimit + 1);
    expect(share.slice(0, publicLimit)).toEqual(Array<number>(publicLimit).fill(200));
    expect(share.at(-1)).toBe(429);
  });
});
