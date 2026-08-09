import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../persistence/database.service';

// Deliberately unauthenticated — kubelet has no bearer token. Guards in this codebase are
// applied per-controller rather than globally, so an unguarded controller is the established
// way to expose a public route; see er-brief-public.controller.ts.
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly database: DatabaseService) {}

  // Liveness. Must not touch the database: restarting the pod does not fix a sick database, it
  // just turns a degraded API into a crash loop.
  @Get()
  live() {
    return { status: 'ok' };
  }

  // Readiness. This one does touch the database, because "ready" means ready to serve real
  // requests, and every route but this one needs a working connection.
  @Get('ready')
  async ready() {
    try {
      await this.database.ping();
    } catch (err) {
      this.logger.error(`Readiness check failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('DATABASE_UNAVAILABLE');
    }
    return { status: 'ready', db: this.database.client };
  }
}
