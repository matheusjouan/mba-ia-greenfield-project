import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CreateVideoDto } from './dto/create-video.dto';
import { VideoUploadResponseDto } from './dto/video-upload.response.dto';
import { VideosService } from './videos.service';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Start a video upload',
    description:
      'Pre-registers the video as a draft in the caller channel and opens a multipart upload. ' +
      'The file is sent straight to the object storage: PUT each part to its presigned URL, ' +
      'keep the ETag headers, then call POST /videos/{slug}/upload/complete.',
  })
  @ApiResponse({
    status: 201,
    description: 'Draft created; presigned part URLs returned',
    type: VideoUploadResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation failed (VALIDATION_ERROR) or file above the size limit (VIDEO_FILE_TOO_LARGE)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoDto,
  ): Promise<VideoUploadResponseDto> {
    const initiated = await this.videosService.initiateUpload(user.sub, {
      fileName: dto.file_name,
      fileSize: dto.file_size,
      mimeType: dto.mime_type,
      title: dto.title,
    });
    return VideoUploadResponseDto.from(initiated);
  }
}
