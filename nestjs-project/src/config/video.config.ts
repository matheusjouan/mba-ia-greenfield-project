import { registerAs } from '@nestjs/config';

export default registerAs('video', () => ({
  maxFileSizeBytes: parseInt(
    process.env.VIDEO_MAX_FILE_SIZE_BYTES || '10737418240',
    10,
  ),
  uploadPartSizeBytes: parseInt(
    process.env.VIDEO_UPLOAD_PART_SIZE_BYTES || '104857600',
    10,
  ),
  uploadUrlExpirationSeconds: parseInt(
    process.env.VIDEO_UPLOAD_URL_EXPIRATION_SECONDS || '3600',
    10,
  ),
  playbackUrlExpirationSeconds: parseInt(
    process.env.VIDEO_PLAYBACK_URL_EXPIRATION_SECONDS || '14400',
    10,
  ),
}));
