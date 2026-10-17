import type { JobsOptions } from 'bullmq';

export const VIDEO_PROCESSING_QUEUE = 'video-processing';

export const PROCESS_VIDEO_JOB = 'process-video';

/** Message contract between the API (producer) and the video worker. */
export interface ProcessVideoJobData {
  videoId: string;
}

export const PROCESS_VIDEO_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: true,
  // Failed jobs are kept so a repeated enqueue of the same video id stays a no-op
  removeOnFail: false,
} as const satisfies JobsOptions;
