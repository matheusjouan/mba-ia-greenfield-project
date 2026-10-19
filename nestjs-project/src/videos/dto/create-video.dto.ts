import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { VIDEO_ALLOWED_MIME_TYPES } from '../videos.constants';
import type { VideoMimeType } from '../videos.constants';

export class CreateVideoDto {
  /** Original name of the file being uploaded. */
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  file_name: string;

  /** Exact size of the file in bytes (at most 10 GiB). */
  @IsInt()
  @Min(1)
  file_size: number;

  /** MIME type of the video file. */
  @IsIn(VIDEO_ALLOWED_MIME_TYPES)
  mime_type: VideoMimeType;

  /** Video title; defaults to the file name without its extension. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title?: string;
}
