import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import videoConfig from '../config/video.config';
import { bullRootOptions } from '../queues/bull-root.options';
import {
  ALL_ENTITIES,
  createTestDataSource,
} from '../test/create-test-data-source';
import { VideoProcessingProcessor } from './video-processing.processor';
import { VideoWorkerModule } from './video-worker.module';

describe('VideoWorkerModule', () => {
  it('should compile with the processor wired to the queue', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig, videoConfig, queueConfig],
        }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        BullModule.forRootAsync({
          inject: [queueConfig.KEY],
          useFactory: (config: ConfigType<typeof queueConfig>) =>
            bullRootOptions(config),
        }),
        VideoWorkerModule,
      ],
    }).compile();

    expect(moduleRef.get(VideoProcessingProcessor)).toBeInstanceOf(
      VideoProcessingProcessor,
    );
    await moduleRef.close();
  }, 30000);
});
