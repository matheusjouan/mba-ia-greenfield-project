import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import { VideoProcessingProducer } from '../queues/video-processing.producer';
import {
  UploadSizeMismatchException,
  VideoFileTooLargeException,
  VideoNotFoundException,
  VideoNotInDraftException,
} from '../common/exceptions/domain.exception';
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
    findOne: jest.fn(),
  };
  const channelsService = { findByUserId: jest.fn() };
  const storageService = {
    createMultipartUpload: jest.fn(),
    abortMultipartUpload: jest.fn(),
    presignUploadPart: jest.fn(),
    listParts: jest.fn(),
    completeMultipartUpload: jest.fn(),
    headObject: jest.fn(),
    deleteObject: jest.fn(),
  };
  const producer = { enqueue: jest.fn() };

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
        { provide: VideoProcessingProducer, useValue: producer },
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

  function storedVideo(overrides: Partial<Video> = {}): Video {
    return {
      id: 'video-1',
      slug: 'abcdefghijk',
      status: VideoStatus.Draft,
      file_size: PART_SIZE + 10,
      storage_key: 'videos/video-1/source.mp4',
      upload_id: 'upload-1',
      processing_error: null,
      channel: { user_id: 'owner-1' },
      ...overrides,
    } as Video;
  }

  describe('getUploadStatus', () => {
    it('hides videos owned by another user behind VIDEO_NOT_FOUND', async () => {
      videoRepository.findOne.mockResolvedValue(storedVideo());

      await expect(
        service.getUploadStatus('intruder', 'abcdefghijk'),
      ).rejects.toThrow(VideoNotFoundException);
    });

    it('rejects unknown slugs with VIDEO_NOT_FOUND', async () => {
      videoRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getUploadStatus('owner-1', 'missing0000'),
      ).rejects.toThrow(VideoNotFoundException);
    });

    it('returns URLs only for the parts not uploaded yet', async () => {
      videoRepository.findOne.mockResolvedValue(storedVideo());
      storageService.listParts.mockResolvedValue([
        { partNumber: 1, etag: '"e1"', size: PART_SIZE },
      ]);

      const { upload } = await service.getUploadStatus(
        'owner-1',
        'abcdefghijk',
      );

      expect(upload!.partCount).toBe(2);
      expect(upload!.uploadedParts).toEqual([
        { partNumber: 1, etag: '"e1"', size: PART_SIZE },
      ]);
      expect(upload!.parts.map((part) => part.partNumber)).toEqual([2]);
    });

    it('returns no upload data once the video left the draft state', async () => {
      videoRepository.findOne.mockResolvedValue(
        storedVideo({ status: VideoStatus.Processing, upload_id: null }),
      );

      const result = await service.getUploadStatus('owner-1', 'abcdefghijk');

      expect(result.upload).toBeNull();
      expect(storageService.listParts).not.toHaveBeenCalled();
    });
  });

  describe('completeUpload', () => {
    const parts = [
      { partNumber: 1, etag: '"e1"' },
      { partNumber: 2, etag: '"e2"' },
    ];

    it('moves the draft to processing and enqueues the job', async () => {
      videoRepository.findOne.mockResolvedValue(storedVideo());
      storageService.headObject.mockResolvedValue({
        contentLength: PART_SIZE + 10,
      });

      const video = await service.completeUpload(
        'owner-1',
        'abcdefghijk',
        parts,
      );

      expect(video.status).toBe(VideoStatus.Processing);
      expect(video.upload_id).toBeNull();
      expect(producer.enqueue).toHaveBeenCalledWith('video-1');
    });

    it('refuses to complete a video that is not a draft', async () => {
      videoRepository.findOne.mockResolvedValue(
        storedVideo({ status: VideoStatus.Processing }),
      );

      await expect(
        service.completeUpload('owner-1', 'abcdefghijk', parts),
      ).rejects.toThrow(VideoNotInDraftException);
      expect(storageService.completeMultipartUpload).not.toHaveBeenCalled();
    });

    it('rejects a non-owner with VIDEO_NOT_FOUND', async () => {
      videoRepository.findOne.mockResolvedValue(storedVideo());

      await expect(
        service.completeUpload('intruder', 'abcdefghijk', parts),
      ).rejects.toThrow(VideoNotFoundException);
    });

    it('deletes the object and fails the video when the size differs', async () => {
      videoRepository.findOne.mockResolvedValue(storedVideo());
      storageService.headObject.mockResolvedValue({ contentLength: 5 });

      await expect(
        service.completeUpload('owner-1', 'abcdefghijk', parts),
      ).rejects.toThrow(UploadSizeMismatchException);

      expect(storageService.deleteObject).toHaveBeenCalledWith(
        'videos/video-1/source.mp4',
      );
      const saved = videoRepository.save.mock.calls.at(-1)![0];
      expect(saved.status).toBe(VideoStatus.Failed);
      expect(saved.processing_error).toBeTruthy();
      expect(producer.enqueue).not.toHaveBeenCalled();
    });

    it('fails the video when the job cannot be enqueued', async () => {
      videoRepository.findOne.mockResolvedValue(storedVideo());
      storageService.headObject.mockResolvedValue({
        contentLength: PART_SIZE + 10,
      });
      producer.enqueue.mockRejectedValueOnce(new Error('redis down'));

      await expect(
        service.completeUpload('owner-1', 'abcdefghijk', parts),
      ).rejects.toThrow('redis down');

      const saved = videoRepository.save.mock.calls.at(-1)![0];
      expect(saved.status).toBe(VideoStatus.Failed);
    });
  });
});
