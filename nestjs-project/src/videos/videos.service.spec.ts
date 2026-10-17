import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import { VideoFileTooLargeException } from '../common/exceptions/domain.exception';
import videoConfig from '../config/video.config';
import { StorageService } from '../storage/storage.service';
import { Video } from './entities/video.entity';
import { VideoStatus } from './videos.constants';
import { VideosService } from './videos.service';

const PART_SIZE = 100 * 1024 * 1024;

function uniqueViolation(column: string): QueryFailedError {
  return new QueryFailedError(
    'INSERT INTO "videos"',
    [],
    Object.assign(new Error('duplicate key'), {
      code: '23505',
      detail: `Key (${column})=(value) already exists.`,
    }),
  );
}

describe('VideosService', () => {
  let service: VideosService;
  const videoRepository = {
    create: jest.fn((data: Partial<Video>) => ({ ...data }) as Video),
    save: jest.fn((video: Video) => Promise.resolve(video)),
  };
  const channelsService = { findByUserId: jest.fn() };
  const storageService = {
    createMultipartUpload: jest.fn(),
    abortMultipartUpload: jest.fn(),
    presignUploadPart: jest.fn(),
  };

  const input = {
    fileName: 'My Clip.mp4',
    fileSize: 25 * 1024 * 1024,
    mimeType: 'video/mp4' as const,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    channelsService.findByUserId.mockResolvedValue({ id: 'channel-1' });
    storageService.createMultipartUpload.mockResolvedValue('upload-1');
    storageService.presignUploadPart.mockImplementation(
      (_key: string, _uploadId: string, partNumber: number) =>
        Promise.resolve(`http://minio:9000/part/${partNumber}`),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: getRepositoryToken(Video), useValue: videoRepository },
        { provide: ChannelsService, useValue: channelsService },
        { provide: StorageService, useValue: storageService },
        {
          provide: videoConfig.KEY,
          useValue: {
            maxFileSizeBytes: 10737418240,
            uploadPartSizeBytes: PART_SIZE,
            uploadUrlExpirationSeconds: 3600,
            playbackUrlExpirationSeconds: 14400,
          },
        },
      ],
    }).compile();

    service = moduleRef.get(VideosService);
  });

  describe('initiateUpload', () => {
    it('rejects files above the maximum size before touching the storage', async () => {
      await expect(
        service.initiateUpload('user-1', { ...input, fileSize: 10737418241 }),
      ).rejects.toThrow(VideoFileTooLargeException);

      expect(storageService.createMultipartUpload).not.toHaveBeenCalled();
      expect(videoRepository.save).not.toHaveBeenCalled();
    });

    it('persists a draft in the user channel keyed by the video id', async () => {
      const { video } = await service.initiateUpload('user-1', input);

      expect(video.status).toBe(VideoStatus.Draft);
      expect(video.channel_id).toBe('channel-1');
      expect(video.upload_id).toBe('upload-1');
      expect(video.storage_key).toBe(`videos/${video.id}/source.mp4`);
      expect(storageService.createMultipartUpload).toHaveBeenCalledWith(
        video.storage_key,
        'video/mp4',
      );
    });

    it('derives the title from the file name when none is given', async () => {
      const { video } = await service.initiateUpload('user-1', input);

      expect(video.title).toBe('My Clip');
    });

    it('keeps an explicit title', async () => {
      const { video } = await service.initiateUpload('user-1', {
        ...input,
        title: 'Custom title',
      });

      expect(video.title).toBe('Custom title');
    });

    it('returns one presigned URL per part', async () => {
      const { upload } = await service.initiateUpload('user-1', {
        ...input,
        fileSize: PART_SIZE * 2 + 1,
      });

      expect(upload.partSize).toBe(PART_SIZE);
      expect(upload.partCount).toBe(3);
      expect(upload.parts.map((part) => part.partNumber)).toEqual([1, 2, 3]);
      expect(upload.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('regenerates the slug when it collides with an existing one', async () => {
      const slugs: string[] = [];
      videoRepository.save
        .mockImplementationOnce((video: Video) => {
          slugs.push(video.slug);
          return Promise.reject(uniqueViolation('slug'));
        })
        .mockImplementationOnce((video: Video) => {
          slugs.push(video.slug);
          return Promise.resolve(video);
        });

      const { video } = await service.initiateUpload('user-1', input);

      expect(videoRepository.save).toHaveBeenCalledTimes(2);
      expect(slugs[0]).not.toBe(slugs[1]);
      expect(video.slug).toBe(slugs[1]);
    });

    it('aborts the multipart upload when the draft cannot be persisted', async () => {
      const failure = new Error('database down');
      videoRepository.save.mockRejectedValueOnce(failure);

      await expect(service.initiateUpload('user-1', input)).rejects.toBe(
        failure,
      );

      const [key] = storageService.createMultipartUpload.mock.calls[0] as [
        string,
      ];
      expect(storageService.abortMultipartUpload).toHaveBeenCalledWith(
        key,
        'upload-1',
      );
    });

    it('does not retry unique violations on other columns', async () => {
      videoRepository.save.mockRejectedValueOnce(uniqueViolation('id'));

      await expect(service.initiateUpload('user-1', input)).rejects.toThrow(
        QueryFailedError,
      );
      expect(videoRepository.save).toHaveBeenCalledTimes(1);
    });
  });
});
