import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  // SIGTERM (docker compose stop) closes the BullMQ worker after the active job
  app.enableShutdownHooks();
  new Logger('VideoWorker').log(
    'Video worker started, consuming video-processing',
  );
}
void bootstrap();
