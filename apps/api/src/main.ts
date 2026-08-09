import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { ValidationPipe } from '@nestjs/common';
import { DatabaseService } from './app/persistence/database.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
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
  // strategy: Recreate (see k8s-infra apps/salud/prod), so there is never a second writer racing
  // this. Set RUN_MIGRATIONS=false to opt out.
  if (process.env.RUN_MIGRATIONS !== 'false') {
    await app.get(DatabaseService).runMigrations();
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`
  );
}

bootstrap();
