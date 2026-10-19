import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import queueConfig from '../config/queue.config';
import { bullRootOptions } from './bull-root.options';
import { VIDEO_PROCESSING_QUEUE } from './queues.constants';
import { QueuesModule } from './queues.module';
import { VideoProcessingProducer } from './video-processing.producer';

describe('QueuesModule', () => {
  it('should compile with the video-processing queue and its producer', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [queueConfig] }),
        BullModule.forRootAsync({
          inject: [queueConfig.KEY],
          useFactory: (config: ConfigType<typeof queueConfig>) =>
            bullRootOptions(config),
        }),
        QueuesModule,
      ],
    }).compile();

    expect(moduleRef.get(VideoProcessingProducer)).toBeInstanceOf(
      VideoProcessingProducer,
    );
    expect(moduleRef.get(getQueueToken(VIDEO_PROCESSING_QUEUE))).toBeDefined();
    await moduleRef.close();
  });
});
