import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app/app.module';
import { ValidationPipe } from '@nestjs/common';
import { DatabaseService } from './app/persistence/database.service';
import { applyAppSecurity } from './app/app.security';
import { applyAppObservability } from './app/app.observability';
import { StorageService } from './app/storage/storage.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  applyAppSecurity(app);
  applyAppObservability(app);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  // Without this, OnModuleDestroy hooks (e.g. DatabaseService closing the DB connection) never run
  // on SIGTERM/SIGINT and the process exits with the driver handle still open.
  app.enableShutdownHooks();

  // Before listening, not after: a pod that is serving requests against a schema-less database
  // would pass its readiness probe and then 500 on everything. Deploys run one replica with
  // strategy: Recreate (see k8s-infra apps/salud/prod) — originally because SQLite is a
  // single-writer file, and now because the attachments volume is still ReadWriteOnce even though
  // the database itself moved to Postgres (app-spec/deployment.md) — so there is still never a
  // second *pod* racing this. On Postgres specifically, drizzle's migrator also takes its own
  // advisory lock, so even a future multi-replica rollout wouldn't race two pods' migrations
  // against each other; it's only the SQLite lineage that depends on the single-writer premise
  // above. Set RUN_MIGRATIONS=false to opt out.
  if (process.env.RUN_MIGRATIONS !== 'false') {
    await app.get(DatabaseService).runMigrations();
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  // Which storage backend is live is worth one line at boot: a wrong FILE_STORAGE_DRIVER now
  // refuses to start (app-spec/persistence.md), but a *right* one pointed at the wrong bucket
  // still looks like data loss on the first download, and this is the cheapest way to catch it.
  const storage = app.get(StorageService);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix} ` +
      `(file storage: ${storage.driver}, bucket: ${storage.bucketLabel})`
  );
}

bootstrap();
