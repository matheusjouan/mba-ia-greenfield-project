import { randomBytes, randomUUID } from 'node:crypto';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import {
  InvalidUploadPartsException,
  UploadExpiredException,
  UploadSizeMismatchException,
  VideoFileTooLargeException,
  VideoNotFoundException,
  VideoNotInDraftException,
} from '../common/exceptions/domain.exception';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import videoConfig from '../config/video.config';
import { bullRootOptions } from '../queues/bull-root.options';
import { VIDEO_PROCESSING_QUEUE } from '../queues/queues.constants';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import { VideoStatus } from './videos.constants';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];
const MIB = 1024 * 1024;
const PART_SIZE = 5 * MIB;

describe('VideosService (integration)', () => {
  let moduleRef: TestingModule;
  let service: VideosService;
  let storage: StorageService;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let queue: Queue;
  let counter = 0;

  async function putPart(url: string, size: number): Promise<string> {
    const response = await fetch(url, {
      method: 'PUT',
      body: new Uint8Array(randomBytes(size)),
    });
    expect(response.status).toBe(200);
    return response.headers.get('etag')!;
  }

  async function createOwner(): Promise<User> {
    counter += 1;
    const users = dataSource.getRepository(User);
    const user = await users.save(
      users.create({ email: `uploader_${counter}@example.com`, password: 'x' }),
    );
    const channels = dataSource.getRepository(Channel);
    await channels.save(
      channels.create({
        name: `uploader${counter}`,
        nickname: `uploader${counter}`,
        user_id: user.id,
      }),
    );
    return user;
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
      ],
    })
      // 5 MiB (S3 minimum) parts keep multi-part scenarios small
      .overrideProvider(videoConfig.KEY)
      .useValue({ ...videoConfig(), uploadPartSizeBytes: PART_SIZE })
      .compile();

    service = moduleRef.get(VideosService);
    storage = moduleRef.get(StorageService);
    dataSource = moduleRef.get(DataSource);
    videoRepository = moduleRef.get(getRepositoryToken(Video));
    queue = moduleRef.get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE));
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  describe('initiateUpload', () => {
    it('pre-registers a draft and opens a multipart upload in the storage', async () => {
      const owner = await createOwner();

      const { video, upload } = await service.initiateUpload(owner.id, {
        fileName: 'clip.mp4',
        fileSize: 25 * MIB,
        mimeType: 'video/mp4',
      });

      const stored = await videoRepository.findOneOrFail({
        where: { id: video.id },
        relations: { channel: true },
      });
      expect(stored.status).toBe(VideoStatus.Draft);
      expect(stored.channel.user_id).toBe(owner.id);
      expect(stored.storage_key).toBe(`videos/${video.id}/source.mp4`);
      expect(stored.upload_id).not.toBeNull();
      expect(stored.slug).toHaveLength(11);
      expect(upload.partCount).toBe(5);
      await storage.abortMultipartUpload(stored.storage_key, stored.upload_id!);
    });

    it('returns part URLs that accept the bytes directly', async () => {
      const owner = await createOwner();
      const { video, upload } = await service.initiateUpload(owner.id, {
        fileName: 'clip.mp4',
        fileSize: MIB,
        mimeType: 'video/mp4',
      });

      const response = await fetch(upload.parts[0].url, {
        method: 'PUT',
        body: new Uint8Array(randomBytes(MIB)),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('etag')).toBeTruthy();
      const parts = await storage.listParts(
        video.storage_key,
        video.upload_id!,
      );
      expect(parts).toHaveLength(1);
      await storage.abortMultipartUpload(video.storage_key, video.upload_id!);
    });

    it('creates nothing when the file is above the maximum size', async () => {
      const owner = await createOwner();

      await expect(
        service.initiateUpload(owner.id, {
          fileName: 'huge.mp4',
          fileSize: 10737418241,
          mimeType: 'video/mp4',
        }),
      ).rejects.toThrow(VideoFileTooLargeException);

      expect(await videoRepository.count()).toBe(0);
    });

    it('gives two uploads of the same file distinct slugs', async () => {
      const owner = await createOwner();
      const input = {
        fileName: 'same.mp4',
        fileSize: MIB,
        mimeType: 'video/mp4' as const,
      };

      const first = await service.initiateUpload(owner.id, input);
      const second = await service.initiateUpload(owner.id, input);

      expect(first.video.slug).not.toBe(second.video.slug);
      await storage.abortMultipartUpload(
        first.video.storage_key,
        first.video.upload_id!,
      );
      await storage.abortMultipartUpload(
        second.video.storage_key,
        second.video.upload_id!,
      );
    });

    it('aborts the multipart upload when the draft cannot be persisted', async () => {
      const owner = await createOwner();
      const createSpy = jest.spyOn(storage, 'createMultipartUpload');
      jest
        .spyOn(videoRepository, 'save')
        .mockRejectedValueOnce(new Error('database down'));

      await expect(
        service.initiateUpload(owner.id, {
          fileName: 'clip.mp4',
          fileSize: MIB,
          mimeType: 'video/mp4',
        }),
      ).rejects.toThrow('database down');

      const [key] = createSpy.mock.calls[0];
      const uploadId = (await createSpy.mock.results[0].value) as string;
      await expect(storage.listParts(key, uploadId)).rejects.toThrow(
        UploadExpiredException,
      );
      createSpy.mockRestore();
    });
  });

  describe('getUploadStatus', () => {
    it('lists uploaded parts and re-signs only the missing ones', async () => {
      const owner = await createOwner();
      const { video, upload } = await service.initiateUpload(owner.id, {
        fileName: 'two-parts.mp4',
        fileSize: PART_SIZE + MIB,
        mimeType: 'video/mp4',
      });
      const etag = await putPart(upload.parts[0].url, PART_SIZE);

      const status = await service.getUploadStatus(owner.id, video.slug);

      expect(status.video.status).toBe(VideoStatus.Draft);
      expect(status.upload!.uploadedParts).toEqual([
        { partNumber: 1, etag, size: PART_SIZE },
      ]);
      expect(status.upload!.parts.map((part) => part.partNumber)).toEqual([2]);
      await storage.abortMultipartUpload(video.storage_key, video.upload_id!);
    });

    it('reports UPLOAD_EXPIRED when the multipart upload no longer exists', async () => {
      const owner = await createOwner();
      const { video } = await service.initiateUpload(owner.id, {
        fileName: 'expired.mp4',
        fileSize: MIB,
        mimeType: 'video/mp4',
      });
      await storage.abortMultipartUpload(video.storage_key, video.upload_id!);

      await expect(
        service.getUploadStatus(owner.id, video.slug),
      ).rejects.toThrow(UploadExpiredException);
    });

    it('hides the video from other users', async () => {
      const owner = await createOwner();
      const intruder = await createOwner();
      const { video } = await service.initiateUpload(owner.id, {
        fileName: 'private.mp4',
        fileSize: MIB,
        mimeType: 'video/mp4',
      });

      await expect(
        service.getUploadStatus(intruder.id, video.slug),
      ).rejects.toThrow(VideoNotFoundException);
      await storage.abortMultipartUpload(video.storage_key, video.upload_id!);
    });
  });

  describe('completeUpload', () => {
    beforeEach(async () => {
      await queue.obliterate({ force: true });
    });

    it('assembles the parts, moves the video to processing and enqueues the job', async () => {
      const owner = await createOwner();
      const { video, upload } = await service.initiateUpload(owner.id, {
        fileName: 'two-parts.mp4',
        fileSize: PART_SIZE + MIB,
        mimeType: 'video/mp4',
      });
      const etags = [
        await putPart(upload.parts[0].url, PART_SIZE),
        await putPart(upload.parts[1].url, MIB),
      ];

      await service.completeUpload(owner.id, video.slug, [
        { partNumber: 1, etag: etags[0] },
        { partNumber: 2, etag: etags[1] },
      ]);

      const stored = await videoRepository.findOneByOrFail({ id: video.id });
      expect(stored.status).toBe(VideoStatus.Processing);
      expect(stored.upload_id).toBeNull();
      const job = await queue.getJob(video.id);
      expect(job?.data).toEqual({ videoId: video.id });
      await storage.deleteObject(video.storage_key);
    });

    it('rejects a second completion with VIDEO_NOT_IN_DRAFT', async () => {
      const owner = await createOwner();
      const { video, upload } = await service.initiateUpload(owner.id, {
        fileName: 'once.mp4',
        fileSize: MIB,
        mimeType: 'video/mp4',
      });
      const etag = await putPart(upload.parts[0].url, MIB);
      const parts = [{ partNumber: 1, etag }];
      await service.completeUpload(owner.id, video.slug, parts);

      await expect(
        service.completeUpload(owner.id, video.slug, parts),
      ).rejects.toThrow(VideoNotInDraftException);
      await storage.deleteObject(video.storage_key);
    });

    it('keeps the draft when the storage rejects the parts', async () => {
      const owner = await createOwner();
      const { video, upload } = await service.initiateUpload(owner.id, {
        fileName: 'bad-etag.mp4',
        fileSize: MIB,
        mimeType: 'video/mp4',
      });
      await putPart(upload.parts[0].url, MIB);

      await expect(
        service.completeUpload(owner.id, video.slug, [
          { partNumber: 1, etag: '"00000000000000000000000000000000"' },
        ]),
      ).rejects.toThrow(InvalidUploadPartsException);

      const stored = await videoRepository.findOneByOrFail({ id: video.id });
      expect(stored.status).toBe(VideoStatus.Draft);
      await storage.abortMultipartUpload(video.storage_key, video.upload_id!);
    });

    it('deletes the object and fails the video when the stored size differs from the declared one', async () => {
      const owner = await createOwner();
      const { video, upload } = await service.initiateUpload(owner.id, {
        fileName: 'lying.mp4',
        fileSize: 2 * MIB,
        mimeType: 'video/mp4',
      });
      const etag = await putPart(upload.parts[0].url, MIB);

      await expect(
        service.completeUpload(owner.id, video.slug, [{ partNumber: 1, etag }]),
      ).rejects.toThrow(UploadSizeMismatchException);

      const stored = await videoRepository.findOneByOrFail({ id: video.id });
      expect(stored.status).toBe(VideoStatus.Failed);
      expect(stored.processing_error).toBeTruthy();
      await expect(storage.headObject(video.storage_key)).rejects.toThrow();
      expect(await queue.getJob(video.id)).toBeUndefined();
    });
  });

  describe('findReadyBySlug', () => {
    async function videoWithStatus(status: VideoStatus): Promise<Video> {
      const owner = await createOwner();
      const channel = await dataSource
        .getRepository(Channel)
        .findOneByOrFail({ user_id: owner.id });
      const id = randomUUID();
      return videoRepository.save(
        videoRepository.create({
          id,
          slug: id.slice(0, 11),
          channel_id: channel.id,
          title: status,
          status,
          original_filename: 'clip.mp4',
          mime_type: 'video/mp4',
          file_size: MIB,
          storage_key: `videos/${id}/source.mp4`,
          upload_id: null,
        }),
      );
    }

    it('returns a ready video with its channel', async () => {
      const video = await videoWithStatus(VideoStatus.Ready);

      const found = await service.findReadyBySlug(video.slug);

      expect(found.id).toBe(video.id);
      expect(found.channel.id).toBe(video.channel_id);
    });

    it.each([VideoStatus.Draft, VideoStatus.Processing, VideoStatus.Failed])(
      'hides %s videos behind VIDEO_NOT_FOUND',
      async (status) => {
        const video = await videoWithStatus(status);

        await expect(service.findReadyBySlug(video.slug)).rejects.toThrow(
          VideoNotFoundException,
        );
      },
    );

    it('signs the stream URL of a ready video for the public endpoint', async () => {
      const video = await videoWithStatus(VideoStatus.Ready);

      const url = new URL(await service.getStreamUrl(video.slug));

      expect(url.origin).toBe(
        new URL(process.env.S3_PUBLIC_ENDPOINT ?? 'http://minio:9000').origin,
      );
      expect(url.pathname).toContain(video.storage_key);
    });

    it('refuses to stream a video that is not ready', async () => {
      const video = await videoWithStatus(VideoStatus.Processing);

      await expect(service.getStreamUrl(video.slug)).rejects.toThrow(
        VideoNotFoundException,
      );
    });

    it('signs the download URL with an attachment disposition', async () => {
      const video = await videoWithStatus(VideoStatus.Ready);

      const url = new URL(await service.getDownloadUrl(video.slug));

      expect(url.searchParams.get('response-content-disposition')).toBe(
        'attachment; filename="clip.mp4"',
      );
    });

    it('sanitizes the client-provided file name in the disposition', async () => {
      const video = await videoWithStatus(VideoStatus.Ready);
      await videoRepository.update(
        { id: video.id },
        { original_filename: 'my "clip"\r\nX-Evil: 1/é.mp4' },
      );

      const url = new URL(await service.getDownloadUrl(video.slug));

      expect(url.searchParams.get('response-content-disposition')).toBe(
        'attachment; filename="my _clip___X-Evil: 1__.mp4"',
      );
    });

    it('refuses to download a video that is not ready', async () => {
      const video = await videoWithStatus(VideoStatus.Draft);

      await expect(service.getDownloadUrl(video.slug)).rejects.toThrow(
        VideoNotFoundException,
      );
    });
  });
});
