import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { StorageService } from '../storage/storage.service';
import { videoThumbnailKey } from '../videos/video-storage-keys';
import { VideoStatus } from '../videos/videos.constants';
import { VideosService } from '../videos/videos.service';
import { MediaProbeService } from './media-probe.service';
import { InvalidMediaError } from './media-probe.types';
import type { MediaProbeResult } from './media-probe.types';

/** Thumbnail frame position, as a fraction of the duration (skips intros). */
export const THUMBNAIL_POSITION = 0.1;
const INPUT_URL_TTL_SECONDS = 3600;

@Injectable()
export class VideoProcessingService {
  private readonly logger = new Logger(VideoProcessingService.name);

  constructor(
    private readonly videosService: VideosService,
    private readonly storageService: StorageService,
    private readonly mediaProbe: MediaProbeService,
  ) {}

  /**
   * Extracts metadata and a thumbnail, then marks the video ready. Idempotent:
   * only videos still in `processing` are touched, and outputs are
   * deterministic, so retries and duplicate jobs converge to the same state.
   */
  async process(videoId: string): Promise<void> {
    const video = await this.videosService.findForProcessing(videoId);
    if (!video || video.status !== VideoStatus.Processing) {
      this.logger.log(`Skipping video ${videoId}: not waiting for processing`);
      return;
    }

    // FFmpeg reads the source over HTTP Range requests — never a full download
    const input = await this.storageService.presignGetObject(
      video.storage_key,
      { endpoint: 'internal', expiresIn: INPUT_URL_TTL_SECONDS },
    );

    const media = await this.unrecoverableOnInvalidMedia(() =>
      this.mediaProbe.probe(input),
    );
    const thumbnailKey = videoThumbnailKey(video.id);
    await this.storeThumbnail(input, media, thumbnailKey);

    await this.videosService.markReady(video.id, {
      durationSeconds: media.durationSeconds,
      width: media.width,
      height: media.height,
      metadata: {
        format_name: media.formatName,
        bit_rate: media.bitRate,
        video_codec: media.videoCodec,
        audio_codec: media.audioCodec,
        frame_rate: media.frameRate,
      },
      thumbnailKey,
    });
  }

  private async storeThumbnail(
    input: string,
    media: MediaProbeResult,
    thumbnailKey: string,
  ): Promise<void> {
    const workDir = await mkdtemp(join(tmpdir(), 'video-thumbnail-'));
    try {
      const output = join(workDir, 'thumbnail.jpg');
      await this.unrecoverableOnInvalidMedia(() =>
        this.mediaProbe.extractThumbnail(
          input,
          media.durationSeconds * THUMBNAIL_POSITION,
          output,
        ),
      );
      await this.storageService.putObject(
        thumbnailKey,
        await readFile(output),
        'image/jpeg',
      );
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  /** Unreadable media will never succeed: stop BullMQ from retrying it. */
  private async unrecoverableOnInvalidMedia<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof InvalidMediaError) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  }
}
