import { ApiProperty } from '@nestjs/swagger';
import { VideoStatus } from '../videos.constants';
import type { Video } from '../entities/video.entity';

export class VideoSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'dQw4w9WgXcQ' })
  slug: string;

  @ApiProperty({ example: 'My clip' })
  title: string;

  @ApiProperty({ enum: VideoStatus, example: VideoStatus.Processing })
  status: VideoStatus;

  static from(video: Video): VideoSummaryResponseDto {
    return {
      id: video.id,
      slug: video.slug,
      title: video.title,
      status: video.status,
    };
  }
}
