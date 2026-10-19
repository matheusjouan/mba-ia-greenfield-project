import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { VIDEO_PROCESSING_QUEUE } from '../queues/queues.constants';
import type { ProcessVideoJobData } from '../queues/queues.constants';
import { VideosService } from '../videos/videos.service';
import { VideoProcessingService } from './video-processing.service';

@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessingProcessor.name);

  constructor(
    private readonly videoProcessingService: VideoProcessingService,
    private readonly videosService: VideosService,
  ) {
    super();
  }

  async process(job: Job<ProcessVideoJobData>): Promise<void> {
    await this.videoProcessingService.process(job.data.videoId);
  }

  /**
   * Earlier failed attempts keep the video in `processing` while BullMQ
   * retries; only the final one (or an unrecoverable error) marks it failed.
   */
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<ProcessVideoJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) return;
    const unrecoverable =
      error instanceof UnrecoverableError ||
      error.name === UnrecoverableError.name;
    const lastAttempt = job.attemptsMade >= (job.opts.attempts ?? 1);

    if (!unrecoverable && !lastAttempt) {
      this.logger.warn(
        `Video ${job.data.videoId} attempt ${job.attemptsMade} failed, retrying: ${error.message}`,
      );
      return;
    }

    // Event handler: log instead of rethrowing, which would crash the worker
    try {
      await this.videosService.markFailed(job.data.videoId, error.message);
    } catch (markError) {
      this.logger.error(
        `Could not mark video ${job.data.videoId} as failed`,
        markError instanceof Error ? markError.stack : String(markError),
      );
    }
  }
}
