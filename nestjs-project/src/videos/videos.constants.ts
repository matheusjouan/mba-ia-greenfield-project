export enum VideoStatus {
  Draft = 'draft',
  Processing = 'processing',
  Ready = 'ready',
  Failed = 'failed',
}

export const VIDEO_ALLOWED_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
] as const;

export type VideoMimeType = (typeof VIDEO_ALLOWED_MIME_TYPES)[number];

export const VIDEO_SLUG_LENGTH = 11;
