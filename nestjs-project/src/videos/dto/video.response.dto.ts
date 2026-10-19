import { ApiProperty } from '@nestjs/swagger';
import { VideoStatus } from '../videos.constants';
import type { PublicVideo } from '../videos.types';

export class VideoMetadataDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'mov,mp4,m4a,3gp,3g2,mj2',
  })
  format_name: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 2500000 })
  bit_rate: number | null;

  @ApiProperty({ type: String, nullable: true, example: 'h264' })
  video_codec: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'aac' })
  audio_codec: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 29.97 })
  frame_rate: number | null;
}

export class VideoChannelDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'jane_doe' })
  nickname: string;

  @ApiProperty({ example: 'jane_doe' })
  name: string;
}

export class VideoResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'dQw4w9WgXcQ' })
  slug: string;

  @ApiProperty({ example: 'My clip' })
  title: string;

  @ApiProperty({ enum: VideoStatus, example: VideoStatus.Ready })
  status: VideoStatus;

  @ApiProperty({ example: 212.48 })
  duration_seconds: number;

  @ApiProperty({ example: 1920 })
  width: number;

  @ApiProperty({ example: 1080 })
  height: number;

  @ApiProperty({ example: 'video/mp4' })
  mime_type: string;

  @ApiProperty({ example: 104857600 })
  file_size: number;

  @ApiProperty({ type: VideoMetadataDto })
  metadata: VideoMetadataDto;

  @ApiProperty({ description: 'Presigned GET URL of the generated thumbnail' })
  thumbnail_url: string;

  @ApiProperty({ type: VideoChannelDto })
  channel: VideoChannelDto;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ format: 'date-time' })
  processed_at: string;

  static from({ video, thumbnailUrl }: PublicVideo): VideoResponseDto {
    return {
      id: video.id,
      slug: video.slug,
      title: video.title,
      status: video.status,
      duration_seconds: video.duration_seconds!,
      width: video.width!,
      height: video.height!,
      mime_type: video.mime_type,
      file_size: video.file_size,
      metadata: video.metadata!,
      thumbnail_url: thumbnailUrl,
      channel: {
        id: video.channel.id,
        nickname: video.channel.nickname,
        name: video.channel.name,
      },
      created_at: video.created_at.toISOString(),
      processed_at: video.processed_at!.toISOString(),
    };
  }
}
