import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Redirect,
} from '@nestjs/common';
import type { HttpRedirectResponse } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { CreateVideoDto } from './dto/create-video.dto';
import { VideoSummaryResponseDto } from './dto/video-summary.response.dto';
import { UploadStatusResponseDto } from './dto/upload-status.response.dto';
import { VideoUploadResponseDto } from './dto/video-upload.response.dto';
import { VideoResponseDto } from './dto/video.response.dto';
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

  @Get(':slug/upload')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get the upload/processing state of an owned video',
    description:
      'Owner-only. While the video is a draft, lists the parts already in the storage and ' +
      'returns fresh presigned URLs for the missing ones, so an interrupted upload can resume.',
  })
  @ApiResponse({
    status: 200,
    description: 'Pipeline state (resume data only while draft)',
    type: UploadStatusResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or owned by another user (VIDEO_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 410,
    description: 'Multipart upload expired in the storage (UPLOAD_EXPIRED)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getUploadStatus(
    @CurrentUser() user: JwtPayload,
    @Param('slug') slug: string,
  ): Promise<UploadStatusResponseDto> {
    return UploadStatusResponseDto.from(
      await this.videosService.getUploadStatus(user.sub, slug),
    );
  }

  @Post(':slug/upload/complete')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Complete a video upload',
    description:
      'Owner-only. Assembles the uploaded parts in the storage, checks the stored size and ' +
      'moves the video to processing, enqueuing the automatic processing job.',
  })
  @ApiResponse({
    status: 200,
    description: 'Upload completed; processing started',
    type: VideoSummaryResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation failed (VALIDATION_ERROR), parts rejected by the storage (INVALID_UPLOAD_PARTS) ' +
      'or stored size different from the declared one (UPLOAD_SIZE_MISMATCH)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or owned by another user (VIDEO_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not a draft anymore (VIDEO_NOT_IN_DRAFT)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 410,
    description: 'Multipart upload expired in the storage (UPLOAD_EXPIRED)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('slug') slug: string,
    @Body() dto: CompleteUploadDto,
  ): Promise<VideoSummaryResponseDto> {
    const video = await this.videosService.completeUpload(
      user.sub,
      slug,
      dto.parts.map((part) => ({
        partNumber: part.part_number,
        etag: part.etag,
      })),
    );
    return VideoSummaryResponseDto.from(video);
  }

  @Public()
  @Get(':slug')
  @ApiOperation({
    summary: 'Get a video by its unique URL',
    description:
      'Public metadata of a ready video (duration, dimensions, extracted metadata, channel) ' +
      'with a presigned thumbnail URL. Videos that are not ready are not visible.',
  })
  @ApiResponse({
    status: 200,
    description: 'Ready video',
    type: VideoResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Unknown slug or video not ready (VIDEO_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async findOne(@Param('slug') slug: string): Promise<VideoResponseDto> {
    return VideoResponseDto.from(await this.videosService.getPublicVideo(slug));
  }

  @Public()
  @Get(':slug/stream')
  @Redirect()
  @ApiOperation({
    summary: 'Stream a video',
    description:
      'Redirects to a short-lived presigned URL of the video file. The object storage answers ' +
      'Range requests with 206 Partial Content, so playback starts without a full download.',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to the presigned video URL (Location header)',
  })
  @ApiResponse({
    status: 404,
    description: 'Unknown slug or video not ready (VIDEO_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async stream(@Param('slug') slug: string): Promise<HttpRedirectResponse> {
    return {
      url: await this.videosService.getStreamUrl(slug),
      statusCode: HttpStatus.FOUND,
    };
  }

  @Public()
  @Get(':slug/download')
  @Redirect()
  @ApiOperation({
    summary: 'Download a video',
    description:
      'Redirects to a short-lived presigned URL signed with Content-Disposition: attachment, ' +
      'so the object storage serves the original file as a download.',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to the presigned download URL (Location header)',
  })
  @ApiResponse({
    status: 404,
    description: 'Unknown slug or video not ready (VIDEO_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async download(@Param('slug') slug: string): Promise<HttpRedirectResponse> {
    return {
      url: await this.videosService.getDownloadUrl(slug),
      statusCode: HttpStatus.FOUND,
    };
  }
}
