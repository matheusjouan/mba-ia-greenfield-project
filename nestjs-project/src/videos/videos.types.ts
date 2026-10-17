import type { VideoMimeType } from './videos.constants';
import type { Video } from './entities/video.entity';

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
