import { randomBytes, randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { Channel } from './channels/entities/channel.entity';
import { VIDEO_PROCESSING_QUEUE } from './queues/queues.constants';
import { VideoProcessingProducer } from './queues/video-processing.producer';
import { StorageService } from './storage/storage.service';
import { cleanAllTables } from './test/create-test-data-source';
import { User } from './users/entities/user.entity';
import { Video } from './videos/entities/video.entity';
import { VideoStatus } from './videos/videos.constants';
import { VideoProcessingProcessor } from './video-worker/video-processing.processor';
import { WorkerModule } from './worker.module';

async function waitForStatus(
  dataSource: DataSource,
  videoId: string,
  status: VideoStatus,
  timeoutMs = 30_000,
): Promise<Video> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const video = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: videoId });
    if (video.status === status) return video;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Video ${videoId} did not reach ${status}`);
}

describe('WorkerModule (integration)', () => {
  let app: INestApplicationContext;
  let dataSource: DataSource;

  beforeAll(async () => {
    app = await NestFactory.createApplicationContext(WorkerModule, {
      logger: false,
    });
    dataSource = app.get(DataSource);
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  it('boots without an HTTP server and resolves the queue consumer', () => {
    expect(app.get(VideoProcessingProcessor)).toBeInstanceOf(
      VideoProcessingProcessor,
    );
  });

  it('registers a worker on the video-processing queue', async () => {
    const queue = app.get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE));

    const workers = await queue.getWorkers();

    expect(workers.length).toBeGreaterThanOrEqual(1);
  });

  it('marks a video with unreadable media as failed through the real queue', async () => {
    const users = dataSource.getRepository(User);
    const user = await users.save(
      users.create({ email: `w_${randomUUID()}@example.com`, password: 'x' }),
    );
    const channels = dataSource.getRepository(Channel);
    const channel = await channels.save(
      channels.create({
        name: 'w',
        nickname: `w${randomUUID().slice(0, 8)}`,
        user_id: user.id,
      }),
    );
    const id = randomUUID();
    const storageKey = `videos/${id}/source.mp4`;
    const storage = app.get(StorageService);
    await storage.putObject(storageKey, randomBytes(32 * 1024), 'video/mp4');
    const videos = dataSource.getRepository(Video);
    await videos.save(
      videos.create({
        id,
        slug: randomUUID().slice(0, 11),
        channel_id: channel.id,
        title: 'broken',
        status: VideoStatus.Processing,
        original_filename: 'broken.mp4',
        mime_type: 'video/mp4',
        file_size: 32 * 1024,
        storage_key: storageKey,
        upload_id: null,
      }),
    );

    await app.get(VideoProcessingProducer).enqueue(id);

    const failed = await waitForStatus(dataSource, id, VideoStatus.Failed);
    expect(failed.processing_error).toBeTruthy();
    await storage.deleteObject(storageKey);
  }, 40_000);
});
