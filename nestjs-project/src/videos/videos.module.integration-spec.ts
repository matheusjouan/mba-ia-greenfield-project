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
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';

describe('VideosModule', () => {
  it('should compile and expose VideosService', async () => {
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
        VideosModule,
      ],
    }).compile();

    expect(moduleRef.get(VideosService)).toBeInstanceOf(VideosService);
    await moduleRef.close();
  }, 30000);
});
