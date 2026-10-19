import { ApiProperty } from '@nestjs/swagger';
import { VideoStatus } from '../videos.constants';
import type { UploadStatus } from '../videos.types';
import {
  UploadPartUrlDto,
  UploadSessionDto,
} from './video-upload.response.dto';

export class UploadedPartDto {
  @ApiProperty({ example: 1 })
  part_number: number;

  @ApiProperty({ example: '"5d41402abc4b2a76b9719d911017c592"' })
  etag: string;

  @ApiProperty({ example: 104857600 })
  size: number;
}

export class UploadResumeDto {
  @ApiProperty({ example: 104857600 })
  part_size: number;

  @ApiProperty({ example: 2 })
  part_count: number;

  @ApiProperty({ format: 'date-time' })
  expires_at: string;

  @ApiProperty({ type: [UploadedPartDto] })
  uploaded_parts: UploadedPartDto[];

  @ApiProperty({
    type: [UploadPartUrlDto],
    description: 'Presigned URLs for the parts not uploaded yet',
  })
  parts: UploadPartUrlDto[];
}

export class UploadStatusResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'dQw4w9WgXcQ' })
  slug: string;

  @ApiProperty({ enum: VideoStatus })
  status: VideoStatus;

  @ApiProperty({ type: String, nullable: true })
  processing_error: string | null;

  @ApiProperty({
    type: UploadResumeDto,
    nullable: true,
    description: 'Present only while the video is a draft',
  })
  upload: UploadResumeDto | null;

  static from({ video, upload }: UploadStatus): UploadStatusResponseDto {
    return {
      id: video.id,
      slug: video.slug,
      status: video.status,
      processing_error: video.processing_error,
      upload: upload && {
        ...UploadSessionDto.from(upload),
        uploaded_parts: upload.uploadedParts.map((part) => ({
          part_number: part.partNumber,
          etag: part.etag,
          size: part.size,
        })),
      },
    };
  }
}
