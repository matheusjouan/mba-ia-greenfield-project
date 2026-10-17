import { randomBytes } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import {
  UploadExpiredException,
  VideoFileTooLargeException,
} from '../common/exceptions/domain.exception';
import storageConfig from '../config/storage.config';
import videoConfig from '../config/video.config';
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

describe('VideosService (integration)', () => {
  let moduleRef: TestingModule;
  let service: VideosService;
  let storage: StorageService;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let counter = 0;

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
          load: [storageConfig, videoConfig],
        }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        VideosModule,
      ],
    }).compile();

    service = moduleRef.get(VideosService);
    storage = moduleRef.get(StorageService);
    dataSource = moduleRef.get(DataSource);
    videoRepository = moduleRef.get(getRepositoryToken(Video));
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
      expect(upload.partCount).toBe(1);
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
});
