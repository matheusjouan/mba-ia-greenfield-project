import { randomUUID } from 'node:crypto';
import { extname, parse } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import videoConfig from '../config/video.config';
import { ChannelsService } from '../channels/channels.service';
import { isUniqueViolationOn } from '../common/database/pg-errors';
import {
  UploadSizeMismatchException,
  VideoFileTooLargeException,
  VideoNotFoundException,
  VideoNotInDraftException,
} from '../common/exceptions/domain.exception';
import { VideoProcessingProducer } from '../queues/video-processing.producer';
import { StorageService } from '../storage/storage.service';
import type { CompletedPart } from '../storage/storage.types';
import { Video } from './entities/video.entity';
import { generateVideoSlug } from './video-slug.util';
import { videoSourceKey } from './video-storage-keys';
import { VideoStatus } from './videos.constants';
import type {
  InitiateUploadInput,
  InitiatedUpload,
  PartUploadUrl,
  UploadSession,
  ProcessedVideo,
  PublicVideo,
  UploadStatus,
} from './videos.types';

const MAX_SLUG_ATTEMPTS = 5;
const SLUG_COLUMN = 'slug';
const TITLE_MAX_LENGTH = 100;
const SAFE_EXTENSION = /^\.[a-z0-9]{1,10}$/;
const SIZE_MISMATCH_ERROR =
  'Uploaded file size does not match the declared size';
const ENQUEUE_FAILED_ERROR = 'Could not enqueue the processing job';

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly channelsService: ChannelsService,
    private readonly storageService: StorageService,
    private readonly videoProcessingProducer: VideoProcessingProducer,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

  /**
   * Owner view of the pipeline. While the video is a draft, returns the
   * parts already in the storage and fresh URLs for the missing ones.
   */
  async getUploadStatus(userId: string, slug: string): Promise<UploadStatus> {
    const video = await this.findOwnedBySlug(userId, slug);
    if (video.status !== VideoStatus.Draft) {
      return { video, upload: null };
    }

    const uploadedParts = await this.storageService.listParts(
      video.storage_key,
      video.upload_id!,
    );
    const uploaded = new Set(uploadedParts.map((part) => part.partNumber));
    const partCount = this.partCountOf(video);
    const missing = Array.from({ length: partCount }, (_, i) => i + 1).filter(
      (partNumber) => !uploaded.has(partNumber),
    );

    return {
      video,
      upload: {
        ...(await this.buildUploadSession(video, partCount, missing)),
        uploadedParts,
      },
    };
  }

  /**
   * Closes the multipart upload, checks the stored size and hands the video
   * to the worker: draft → processing (or failed when it cannot proceed).
   */
  async completeUpload(
    userId: string,
    slug: string,
    parts: CompletedPart[],
  ): Promise<Video> {
    const video = await this.findOwnedBySlug(userId, slug);
    if (video.status !== VideoStatus.Draft) {
      throw new VideoNotInDraftException();
    }

    await this.storageService.completeMultipartUpload(
      video.storage_key,
      video.upload_id!,
      parts,
    );
    video.upload_id = null;

    const { contentLength } = await this.storageService.headObject(
      video.storage_key,
    );
    if (contentLength !== video.file_size) {
      await this.storageService.deleteObject(video.storage_key);
      await this.fail(video, SIZE_MISMATCH_ERROR);
      throw new UploadSizeMismatchException();
    }

    video.status = VideoStatus.Processing;
    await this.videoRepository.save(video);

    try {
      await this.videoProcessingProducer.enqueue(video.id);
    } catch (error) {
      await this.fail(video, ENQUEUE_FAILED_ERROR);
      throw error;
    }

    return video;
  }

  /**
   * Pre-registers the video as a draft and opens a multipart upload whose
   * parts the client sends straight to the object storage.
   */
  async initiateUpload(
    userId: string,
    input: InitiateUploadInput,
  ): Promise<InitiatedUpload> {
    if (input.fileSize > this.config.maxFileSizeBytes) {
      throw new VideoFileTooLargeException();
    }

    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new Error(`User ${userId} has no channel`);
    }

    const id = randomUUID();
    const storageKey = videoSourceKey(id, this.safeExtension(input.fileName));
    const uploadId = await this.storageService.createMultipartUpload(
      storageKey,
      input.mimeType,
    );

    let video: Video;
    try {
      video = await this.insertWithUniqueSlug(
        this.videoRepository.create({
          id,
          channel_id: channel.id,
          title: input.title ?? this.titleFromFileName(input.fileName),
          status: VideoStatus.Draft,
          original_filename: input.fileName,
          mime_type: input.mimeType,
          file_size: input.fileSize,
          storage_key: storageKey,
          upload_id: uploadId,
        }),
      );
    } catch (error) {
      await this.storageService.abortMultipartUpload(storageKey, uploadId);
      throw error;
    }

    const partCount = this.partCountOf(video);
    const partNumbers = Array.from({ length: partCount }, (_, i) => i + 1);

    return {
      video,
      upload: await this.buildUploadSession(video, partCount, partNumbers),
    };
  }

  private async buildUploadSession(
    video: Video,
    partCount: number,
    partNumbers: number[],
  ): Promise<UploadSession> {
    const expiresIn = this.config.uploadUrlExpirationSeconds;
    const parts: PartUploadUrl[] = await Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await this.storageService.presignUploadPart(
          video.storage_key,
          video.upload_id!,
          partNumber,
          expiresIn,
        ),
      })),
    );

    return {
      partSize: this.config.uploadPartSizeBytes,
      partCount,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      parts,
    };
  }

  /** Public view by unique URL: only `ready` videos exist for viewers. */
  async getPublicVideo(slug: string): Promise<PublicVideo> {
    const video = await this.findReadyBySlug(slug);
    return {
      video,
      thumbnailUrl: await this.storageService.presignGetObject(
        video.thumbnail_key!,
        {
          endpoint: 'public',
          expiresIn: this.config.playbackUrlExpirationSeconds,
        },
      ),
    };
  }

  async findReadyBySlug(slug: string): Promise<Video> {
    const video = await this.videoRepository.findOne({
      where: { slug, status: VideoStatus.Ready },
      relations: { channel: true },
    });
    if (!video) {
      throw new VideoNotFoundException();
    }
    return video;
  }

  async findForProcessing(id: string): Promise<Video | null> {
    return this.videoRepository.findOneBy({ id });
  }

  /** processing → ready. A no-op if the video left `processing` meanwhile. */
  async markReady(id: string, processed: ProcessedVideo): Promise<void> {
    await this.videoRepository.update(
      { id, status: VideoStatus.Processing },
      {
        status: VideoStatus.Ready,
        duration_seconds: processed.durationSeconds,
        width: processed.width,
        height: processed.height,
        metadata: processed.metadata,
        thumbnail_key: processed.thumbnailKey,
        processing_error: null,
        processed_at: new Date(),
      },
    );
  }

  /** processing → failed, recording why (the last attempt's error). */
  async markFailed(id: string, reason: string): Promise<void> {
    await this.videoRepository.update(
      { id, status: VideoStatus.Processing },
      { status: VideoStatus.Failed, processing_error: reason },
    );
  }

  private async findOwnedBySlug(userId: string, slug: string): Promise<Video> {
    const video = await this.videoRepository.findOne({
      where: { slug },
      relations: { channel: true },
    });
    // A non-owner gets the same answer as a missing video: no existence leak
    if (!video || video.channel.user_id !== userId) {
      throw new VideoNotFoundException();
    }
    return video;
  }

  private async fail(video: Video, reason: string): Promise<void> {
    video.status = VideoStatus.Failed;
    video.processing_error = reason;
    await this.videoRepository.save(video);
  }

  private partCountOf(video: Video): number {
    return Math.ceil(video.file_size / this.config.uploadPartSizeBytes);
  }

  private async insertWithUniqueSlug(video: Video): Promise<Video> {
    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
      video.slug = generateVideoSlug();
      try {
        return await this.videoRepository.save(video);
      } catch (error) {
        if (!isUniqueViolationOn(error, SLUG_COLUMN)) throw error;
      }
    }
    throw new Error(
      `Could not generate a unique video slug after ${MAX_SLUG_ATTEMPTS} attempts`,
    );
  }

  private titleFromFileName(fileName: string): string {
    const name = parse(fileName).name.trim() || fileName;
    return name.slice(0, TITLE_MAX_LENGTH);
  }

  private safeExtension(fileName: string): string {
    const extension = extname(fileName).toLowerCase();
    return SAFE_EXTENSION.test(extension) ? extension : '';
  }
}
