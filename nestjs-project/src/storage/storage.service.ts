import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import storageConfig from '../config/storage.config';
import {
  InvalidUploadPartsException,
  UploadExpiredException,
} from '../common/exceptions/domain.exception';
import {
  INVALID_PARTS_ERROR_NAMES,
  NO_SUCH_UPLOAD_ERROR_NAME,
} from './storage.constants';
import type {
  CompletedPart,
  PresignGetOptions,
  StoredPart,
} from './storage.types';

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly publicPresignClient: S3Client;
  private readonly bucket: string;

  constructor(
    @Inject(storageConfig.KEY)
    config: ConfigType<typeof storageConfig>,
  ) {
    this.bucket = config.bucket;
    this.client = this.createClient(config, config.endpoint);
    this.publicPresignClient = this.createClient(config, config.publicEndpoint);
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    const output = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    return output.UploadId!;
  }

  async presignUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresIn: number,
  ): Promise<string> {
    return getSignedUrl(
      this.publicPresignClient,
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn },
    );
  }

  async listParts(key: string, uploadId: string): Promise<StoredPart[]> {
    const parts: StoredPart[] = [];
    let marker: string | undefined;

    try {
      do {
        const output = await this.client.send(
          new ListPartsCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
            PartNumberMarker: marker,
          }),
        );
        for (const part of output.Parts ?? []) {
          parts.push({
            partNumber: part.PartNumber!,
            etag: part.ETag!,
            size: part.Size!,
          });
        }
        marker = output.IsTruncated ? output.NextPartNumberMarker : undefined;
      } while (marker);
    } catch (error) {
      throw this.mapMultipartError(error);
    }

    return parts;
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<void> {
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);

    try {
      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: ordered.map((part) => ({
              PartNumber: part.partNumber,
              ETag: part.etag,
            })),
          },
        }),
      );
    } catch (error) {
      throw this.mapMultipartError(error);
    }
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  async headObject(key: string): Promise<{ contentLength: number }> {
    const output = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return { contentLength: output.ContentLength ?? 0 };
  }

  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async presignGetObject(
    key: string,
    options: PresignGetOptions,
  ): Promise<string> {
    const client =
      options.endpoint === 'public' ? this.publicPresignClient : this.client;
    return getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: options.downloadFileName
          ? `attachment; filename="${options.downloadFileName}"`
          : undefined,
      }),
      { expiresIn: options.expiresIn },
    );
  }

  private createClient(
    config: ConfigType<typeof storageConfig>,
    endpoint: string,
  ): S3Client {
    return new S3Client({
      endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      // MinIO resolves buckets by path (http://minio:9000/<bucket>/<key>)
      forcePathStyle: true,
      // Default flexible checksums would add checksum parameters to presigned
      // URLs that browser part uploads cannot satisfy.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  private mapMultipartError(error: unknown): unknown {
    const name = (error as { name?: string } | null)?.name;
    if (name === NO_SUCH_UPLOAD_ERROR_NAME) {
      return new UploadExpiredException();
    }
    if (name && INVALID_PARTS_ERROR_NAMES.includes(name)) {
      return new InvalidUploadPartsException();
    }
    return error;
  }
}
