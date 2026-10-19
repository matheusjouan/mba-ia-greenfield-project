import type { VideoMimeType } from './videos.constants';
import type { Video, VideoMetadata } from './entities/video.entity';
import type { StoredPart } from '../storage/storage.types';

export interface InitiateUploadInput {
  fileName: string;
  fileSize: number;
  mimeType: VideoMimeType;
  title?: string;
}

export interface PartUploadUrl {
  partNumber: number;
  url: string;
}

export interface UploadSession {
  partSize: number;
  partCount: number;
  expiresAt: Date;
  parts: PartUploadUrl[];
}

export interface InitiatedUpload {
  video: Video;
  upload: UploadSession;
}

export interface ResumableUpload extends UploadSession {
  uploadedParts: StoredPart[];
}

export interface UploadStatus {
  video: Video;
  /** Present only while the video is a draft. */
  upload: ResumableUpload | null;
}

/** What the worker extracted from the media, persisted on processing → ready. */
export interface ProcessedVideo {
  durationSeconds: number;
  width: number;
  height: number;
  metadata: VideoMetadata;
  thumbnailKey: string;
}

export interface PublicVideo {
  video: Video;
  /** Presigned GET URL of the generated thumbnail. */
  thumbnailUrl: string;
}
