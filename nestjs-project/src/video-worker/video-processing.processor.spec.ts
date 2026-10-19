import { Test } from '@nestjs/testing';
import { Job, UnrecoverableError } from 'bullmq';
import type { ProcessVideoJobData } from '../queues/queues.constants';
import { VideosService } from '../videos/videos.service';
import { VideoProcessingProcessor } from './video-processing.processor';
import { VideoProcessingService } from './video-processing.service';

function jobAt(attemptsMade: number): Job<ProcessVideoJobData> {
  return {
    data: { videoId: 'video-1' },
    attemptsMade,
    opts: { attempts: 3 },
  } as Job<ProcessVideoJobData>;
}

describe('VideoProcessingProcessor', () => {
  let processor: VideoProcessingProcessor;
  const videoProcessingService = { process: jest.fn() };
  const videosService = { markFailed: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        VideoProcessingProcessor,
        { provide: VideoProcessingService, useValue: videoProcessingService },
        { provide: VideosService, useValue: videosService },
      ],
    }).compile();

    processor = moduleRef.get(VideoProcessingProcessor);
  });

  it('processes the video referenced by the job', async () => {
    await processor.process(jobAt(0));

    expect(videoProcessingService.process).toHaveBeenCalledWith('video-1');
  });

  it('keeps the video processing while attempts remain', async () => {
    await processor.onFailed(jobAt(1), new Error('storage timeout'));

    expect(videosService.markFailed).not.toHaveBeenCalled();
  });

  it('marks the video failed after the last attempt', async () => {
    await processor.onFailed(jobAt(3), new Error('storage timeout'));

    expect(videosService.markFailed).toHaveBeenCalledWith(
      'video-1',
      'storage timeout',
    );
  });

  it('marks the video failed at once on an unrecoverable error', async () => {
    await processor.onFailed(
      jobAt(1),
      new UnrecoverableError('No video stream found'),
    );

    expect(videosService.markFailed).toHaveBeenCalledWith(
      'video-1',
      'No video stream found',
    );
  });

  it('does not crash the worker when the video cannot be marked failed', async () => {
    videosService.markFailed.mockRejectedValueOnce(new Error('db down'));

    await expect(
      processor.onFailed(jobAt(3), new Error('storage timeout')),
    ).resolves.toBeUndefined();
  });
});
