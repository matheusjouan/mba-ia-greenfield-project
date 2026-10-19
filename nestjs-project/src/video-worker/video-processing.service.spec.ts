import { writeFile } from 'node:fs/promises';
import { Test } from '@nestjs/testing';
import { UnrecoverableError } from 'bullmq';
import { StorageService } from '../storage/storage.service';
import { VideoStatus } from '../videos/videos.constants';
import { VideosService } from '../videos/videos.service';
import { MediaProbeService } from './media-probe.service';
import { InvalidMediaError } from './media-probe.types';
import { VideoProcessingService } from './video-processing.service';

const media = {
  durationSeconds: 120,
  width: 1920,
  height: 1080,
  formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
  bitRate: 2500000,
  videoCodec: 'h264',
  audioCodec: 'aac',
  frameRate: 30,
};

describe('VideoProcessingService', () => {
  let service: VideoProcessingService;
  const videosService = {
    findForProcessing: jest.fn(),
    markReady: jest.fn(),
  };
  const storageService = {
    presignGetObject: jest.fn(),
    putObject: jest.fn(),
  };
  const mediaProbe = {
    probe: jest.fn(),
    extractThumbnail: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    videosService.findForProcessing.mockResolvedValue({
      id: 'video-1',
      status: VideoStatus.Processing,
      storage_key: 'videos/video-1/source.mp4',
    });
    storageService.presignGetObject.mockResolvedValue('http://minio:9000/src');
    mediaProbe.probe.mockResolvedValue(media);
    mediaProbe.extractThumbnail.mockImplementation(
      (_input: string, _at: number, output: string) =>
        writeFile(output, Buffer.from([0xff, 0xd8, 0xff])),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        VideoProcessingService,
        { provide: VideosService, useValue: videosService },
        { provide: StorageService, useValue: storageService },
        { provide: MediaProbeService, useValue: mediaProbe },
      ],
    }).compile();

    service = moduleRef.get(VideoProcessingService);
  });

  it('skips videos that are not waiting for processing', async () => {
    videosService.findForProcessing.mockResolvedValue({
      id: 'video-1',
      status: VideoStatus.Ready,
    });

    await service.process('video-1');

    expect(mediaProbe.probe).not.toHaveBeenCalled();
    expect(videosService.markReady).not.toHaveBeenCalled();
  });

  it('skips videos that no longer exist', async () => {
    videosService.findForProcessing.mockResolvedValue(null);

    await service.process('video-1');

    expect(mediaProbe.probe).not.toHaveBeenCalled();
  });

  it('reads the source through an internal presigned URL', async () => {
    await service.process('video-1');

    expect(storageService.presignGetObject).toHaveBeenCalledWith(
      'videos/video-1/source.mp4',
      expect.objectContaining({ endpoint: 'internal' }),
    );
    expect(mediaProbe.probe).toHaveBeenCalledWith('http://minio:9000/src');
  });

  it('takes the thumbnail at 10% of the duration', async () => {
    await service.process('video-1');

    expect(mediaProbe.extractThumbnail).toHaveBeenCalledWith(
      'http://minio:9000/src',
      12,
      expect.stringMatching(/thumbnail\.jpg$/),
    );
    expect(storageService.putObject).toHaveBeenCalledWith(
      'videos/video-1/thumbnail.jpg',
      expect.any(Buffer),
      'image/jpeg',
    );
  });

  it('persists the extracted metadata and marks the video ready', async () => {
    await service.process('video-1');

    expect(videosService.markReady).toHaveBeenCalledWith('video-1', {
      durationSeconds: 120,
      width: 1920,
      height: 1080,
      metadata: {
        format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
        bit_rate: 2500000,
        video_codec: 'h264',
        audio_codec: 'aac',
        frame_rate: 30,
      },
      thumbnailKey: 'videos/video-1/thumbnail.jpg',
    });
  });

  it('turns unreadable media into an UnrecoverableError', async () => {
    mediaProbe.probe.mockRejectedValue(
      new InvalidMediaError('No video stream found'),
    );

    await expect(service.process('video-1')).rejects.toThrow(
      UnrecoverableError,
    );
    expect(videosService.markReady).not.toHaveBeenCalled();
  });

  it('lets transient failures propagate for a retry', async () => {
    mediaProbe.probe.mockRejectedValue(new Error('connection refused'));

    const error = await service
      .process('video-1')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
  });
});
