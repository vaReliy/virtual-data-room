import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@dr/contracts';

@Controller('health')
export class HealthController {
  /**
   * Liveness only. It deliberately does not touch the database: Cloud Run restarts a
   * container that fails this, and a brief database blip should not cause a restart loop.
   */
  @Get()
  check(): HealthResponse {
    return { status: 'ok' };
  }
}
