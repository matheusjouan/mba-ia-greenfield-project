import { randomUUID } from 'node:crypto';
import { extname, parse } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import videoConfig from '../config/video.config';
import { ChannelsService } from '../channels/channels.service';
import { isUniqueViolationOn } from '../common/database/pg-errors';
import { VideoFileTooLargeException } from '../common/exceptions/domain.exception';
import { StorageService } from '../storage/storage.service';
import { Video } from './entities/video.entity';
import { generateVideoSlug } from './video-slug.util';
import { VideoStatus } from './videos.constants';
import type {
  InitiateUploadInput,
  InitiatedUpload,
  PartUploadUrl,
  UploadSession,
} from './videos.types';

const MAX_SLUG_ATTEMPTS = 5;
const SLUG_COLUMN = 'slug';
const TITLE_MAX_LENGTH = 100;
const SAFE_EXTENSION = /^\.[a-z0-9]{1,10}$/;

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly channelsService: ChannelsService,
    private readonly storageService: StorageService,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

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
    const storageKey = `videos/${id}/source${this.safeExtension(input.fileName)}`;
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

    const partCount = Math.ceil(
      input.fileSize / this.config.uploadPartSizeBytes,
    );
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
