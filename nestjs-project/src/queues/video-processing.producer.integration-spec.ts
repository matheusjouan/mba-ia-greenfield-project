import { randomUUID } from 'node:crypto';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import queueConfig from '../config/queue.config';
import { bullRootOptions } from './bull-root.options';
import { PROCESS_VIDEO_JOB, VIDEO_PROCESSING_QUEUE } from './queues.constants';
import { QueuesModule } from './queues.module';
import { VideoProcessingProducer } from './video-processing.producer';

describe('VideoProcessingProducer (integration)', () => {
  let moduleRef: TestingModule;
  let producer: VideoProcessingProducer;
  let queue: Queue;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
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

    producer = moduleRef.get(VideoProcessingProducer);
    queue = moduleRef.get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE));
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
  });

  it('enqueues a process-video job keyed by the video id', async () => {
    const videoId = randomUUID();

    await producer.enqueue(videoId);

    const job = await queue.getJob(videoId);
    expect(job).toBeDefined();
    expect(job!.name).toBe(PROCESS_VIDEO_JOB);
    expect(job!.data).toEqual({ videoId });
  });

  it('applies the retry policy of the job contract', async () => {
    const videoId = randomUUID();

    await producer.enqueue(videoId);

    const job = await queue.getJob(videoId);
    expect(job!.opts.attempts).toBe(3);
    expect(job!.opts.backoff).toEqual({ type: 'exponential', delay: 5000 });
  });

  it('ignores a second enqueue of the same video', async () => {
    const videoId = randomUUID();

    await producer.enqueue(videoId);
    await producer.enqueue(videoId);

    expect(await queue.getJobCounts('waiting')).toEqual({ waiting: 1 });
  });

  it('registers no worker on the queue in the API process', async () => {
    expect(await queue.getWorkers()).toEqual([]);
  });

  it('keeps test jobs under the test prefix, away from the compose worker', async () => {
    const videoId = randomUUID();
    await producer.enqueue(videoId);
    const workerQueue = new Queue(VIDEO_PROCESSING_QUEUE, {
      connection: queue.opts.connection,
      prefix: 'bull',
    });

    expect(queue.opts.prefix).toBe('streamtube-test');
    expect(await workerQueue.getJob(videoId)).toBeUndefined();
    await workerQueue.close();
  });
});
