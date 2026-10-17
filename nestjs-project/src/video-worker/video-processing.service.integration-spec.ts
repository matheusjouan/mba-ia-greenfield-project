import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UnrecoverableError } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import videoConfig from '../config/video.config';
import { bullRootOptions } from '../queues/bull-root.options';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from '../videos/entities/video.entity';
import { VideoStatus } from '../videos/videos.constants';
import { VideosModule } from '../videos/videos.module';
import { MediaProbeService } from './media-probe.service';
import { VideoProcessingService } from './video-processing.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];
const FIXTURE = resolve(__dirname, '../../test/fixtures/sample.mp4');

describe('VideoProcessingService (integration)', () => {
  let moduleRef: TestingModule;
  let service: VideoProcessingService;
  let storage: StorageService;
  let dataSource: DataSource;
  let videos: Repository<Video>;
  const createdKeys: string[] = [];

  async function processingVideo(content: Buffer): Promise<Video> {
    const users = dataSource.getRepository(User);
    const user = await users.save(
      users.create({
        email: `worker_${randomUUID()}@example.com`,
        password: 'x',
      }),
    );
    const channels = dataSource.getRepository(Channel);
    const channel = await channels.save(
      channels.create({
        name: 'worker',
        nickname: `w${randomUUID().slice(0, 8)}`,
        user_id: user.id,
      }),
    );

    const id = randomUUID();
    const storageKey = `videos/${id}/source.mp4`;
    await storage.putObject(storageKey, content, 'video/mp4');
    createdKeys.push(storageKey, `videos/${id}/thumbnail.jpg`);

    return videos.save(
      videos.create({
        id,
        slug: randomUUID().slice(0, 11),
        channel_id: channel.id,
        title: 'sample',
        status: VideoStatus.Processing,
        original_filename: 'sample.mp4',
        mime_type: 'video/mp4',
        file_size: content.length,
        storage_key: storageKey,
        upload_id: null,
      }),
    );
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
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
        StorageModule,
      ],
      // The processor (BullMQ worker) is deliberately left out: the service is
      // exercised directly; queue delivery is covered by the worker module test.
      providers: [MediaProbeService, VideoProcessingService],
    }).compile();

    service = moduleRef.get(VideoProcessingService);
    storage = moduleRef.get(StorageService);
    dataSource = moduleRef.get(DataSource);
    videos = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await Promise.all(createdKeys.map((key) => storage.deleteObject(key)));
    await moduleRef.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  it('marks the video ready with its metadata and stores the thumbnail', async () => {
    const video = await processingVideo(await readFile(FIXTURE));

    await service.process(video.id);

    const stored = await videos.findOneByOrFail({ id: video.id });
    expect(stored.status).toBe(VideoStatus.Ready);
    expect(stored.duration_seconds).toBeGreaterThan(2.9);
    expect(stored.duration_seconds).toBeLessThan(3.1);
    expect(stored.width).toBe(320);
    expect(stored.height).toBe(240);
    expect(stored.metadata).toMatchObject({
      video_codec: 'h264',
      audio_codec: 'aac',
      frame_rate: 15,
    });
    expect(stored.processed_at).toBeInstanceOf(Date);
    expect(stored.thumbnail_key).toBe(`videos/${video.id}/thumbnail.jpg`);

    const thumbnailUrl = await storage.presignGetObject(stored.thumbnail_key!, {
      expiresIn: 60,
      endpoint: 'internal',
    });
    const thumbnail = await fetch(thumbnailUrl);
    expect(thumbnail.status).toBe(200);
    expect(thumbnail.headers.get('content-type')).toBe('image/jpeg');
  });

  it('converges to the same state when the same video is processed twice', async () => {
    const video = await processingVideo(await readFile(FIXTURE));
    await service.process(video.id);
    const first = await videos.findOneByOrFail({ id: video.id });

    await service.process(video.id);

    const second = await videos.findOneByOrFail({ id: video.id });
    expect(second.status).toBe(VideoStatus.Ready);
    expect(second.thumbnail_key).toBe(first.thumbnail_key);
    expect(second.processed_at).toEqual(first.processed_at);
  });

  it('refuses unreadable media with an UnrecoverableError', async () => {
    const video = await processingVideo(randomBytes(64 * 1024));

    await expect(service.process(video.id)).rejects.toThrow(UnrecoverableError);
    const stored = await videos.findOneByOrFail({ id: video.id });
    expect(stored.thumbnail_key).toBeNull();
  });
});
