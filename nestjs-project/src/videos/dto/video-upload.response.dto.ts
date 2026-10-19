import { ApiProperty } from '@nestjs/swagger';
import { VideoStatus } from '../videos.constants';
import type { InitiatedUpload, UploadSession } from '../videos.types';

export class UploadPartUrlDto {
  @ApiProperty({ example: 1 })
  part_number: number;

  @ApiProperty({
    description: 'Presigned URL that accepts a PUT of this part bytes',
    example: 'http://minio:9000/streamtube/videos/…/source.mp4?partNumber=1',
  })
  url: string;
}

export class UploadSessionDto {
  @ApiProperty({ example: 104857600 })
  part_size: number;

  @ApiProperty({ example: 1 })
  part_count: number;

  @ApiProperty({ format: 'date-time' })
  expires_at: string;

  @ApiProperty({ type: [UploadPartUrlDto] })
  parts: UploadPartUrlDto[];

  static from(session: UploadSession): UploadSessionDto {
    return {
      part_size: session.partSize,
      part_count: session.partCount,
      expires_at: session.expiresAt.toISOString(),
      parts: session.parts.map((part) => ({
        part_number: part.partNumber,
        url: part.url,
      })),
    };
  }
}

export class VideoUploadResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'dQw4w9WgXcQ' })
  slug: string;

  @ApiProperty({ example: 'My clip' })
  title: string;

  @ApiProperty({ enum: VideoStatus, example: VideoStatus.Draft })
  status: VideoStatus;

  @ApiProperty({ type: UploadSessionDto })
  upload: UploadSessionDto;

  static from({ video, upload }: InitiatedUpload): VideoUploadResponseDto {
    return {
      id: video.id,
      slug: video.slug,
      title: video.title,
      status: video.status,
      upload: UploadSessionDto.from(upload),
    };
  }
}
