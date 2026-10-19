import { randomBytes, randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import storageConfig from '../config/storage.config';
import {
  InvalidUploadPartsException,
  UploadExpiredException,
} from '../common/exceptions/domain.exception';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

const MIB = 1024 * 1024;
const EXPIRES_IN = 300;

describe('StorageService (integration)', () => {
  let storage: StorageService;
  const createdKeys: string[] = [];

  const newKey = (): string => {
    const key = `test/storage-it/${randomUUID()}/source.bin`;
    createdKeys.push(key);
    return key;
  };

  const putPart = async (url: string, body: Buffer): Promise<string> => {
    const response = await fetch(url, {
      method: 'PUT',
      body: new Uint8Array(body),
    });
    expect(response.status).toBe(200);
    return response.headers.get('etag')!;
  };

  const uploadTwoParts = async (
    key: string,
    content: Buffer,
  ): Promise<{ uploadId: string; etags: string[] }> => {
    const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
    const firstUrl = await storage.presignUploadPart(
      key,
      uploadId,
      1,
      EXPIRES_IN,
    );
    const secondUrl = await storage.presignUploadPart(
      key,
      uploadId,
      2,
      EXPIRES_IN,
    );
    const etags = [
      await putPart(firstUrl, content.subarray(0, 5 * MIB)),
      await putPart(secondUrl, content.subarray(5 * MIB)),
    ];
    return { uploadId, etags };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    }).compile();

    storage = moduleRef.get(StorageService);
  });

  afterAll(async () => {
    await Promise.all(createdKeys.map((key) => storage.deleteObject(key)));
  });

  describe('multipart upload through presigned part URLs', () => {
    it('assembles parts uploaded directly to the storage into one object', async () => {
      const key = newKey();
      const content = randomBytes(6 * MIB);
      const { uploadId, etags } = await uploadTwoParts(key, content);

      await storage.completeMultipartUpload(key, uploadId, [
        { partNumber: 2, etag: etags[1] },
        { partNumber: 1, etag: etags[0] },
      ]);

      const head = await storage.headObject(key);
      expect(head.contentLength).toBe(6 * MIB);
    });

    it('lists the parts already uploaded to resume an upload', async () => {
      const key = newKey();
      const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
      const url = await storage.presignUploadPart(key, uploadId, 1, EXPIRES_IN);
      const etag = await putPart(url, randomBytes(5 * MIB));

      const parts = await storage.listParts(key, uploadId);

      expect(parts).toEqual([{ partNumber: 1, etag, size: 5 * MIB }]);
      await storage.abortMultipartUpload(key, uploadId);
    });

    it('maps an unknown upload id to UploadExpiredException', async () => {
      const key = newKey();

      await expect(storage.listParts(key, 'missing-upload')).rejects.toThrow(
        UploadExpiredException,
      );
      await expect(
        storage.completeMultipartUpload(key, 'missing-upload', [
          { partNumber: 1, etag: '"abc"' },
        ]),
      ).rejects.toThrow(UploadExpiredException);
    });

    it('maps an ETag that does not match the part to InvalidUploadPartsException', async () => {
      const key = newKey();
      const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
      const url = await storage.presignUploadPart(key, uploadId, 1, EXPIRES_IN);
      await putPart(url, randomBytes(MIB));

      await expect(
        storage.completeMultipartUpload(key, uploadId, [
          { partNumber: 1, etag: '"00000000000000000000000000000000"' },
        ]),
      ).rejects.toThrow(InvalidUploadPartsException);
      await storage.abortMultipartUpload(key, uploadId);
    });

    it('makes listParts fail with UploadExpiredException after an abort', async () => {
      const key = newKey();
      const uploadId = await storage.createMultipartUpload(key, 'video/mp4');

      await storage.abortMultipartUpload(key, uploadId);

      await expect(storage.listParts(key, uploadId)).rejects.toThrow(
        UploadExpiredException,
      );
    });
  });

  describe('presigned GET URLs', () => {
    let key: string;
    let content: Buffer;

    beforeAll(async () => {
      key = newKey();
      content = randomBytes(6 * MIB);
      const { uploadId, etags } = await uploadTwoParts(key, content);
      await storage.completeMultipartUpload(key, uploadId, [
        { partNumber: 1, etag: etags[0] },
        { partNumber: 2, etag: etags[1] },
      ]);
    });

    it('serves byte ranges with 206 Partial Content', async () => {
      const url = await storage.presignGetObject(key, {
        expiresIn: EXPIRES_IN,
        endpoint: 'public',
      });

      const response = await fetch(url, { headers: { Range: 'bytes=0-99' } });

      expect(response.status).toBe(206);
      expect(response.headers.get('content-range')).toBe(
        `bytes 0-99/${6 * MIB}`,
      );
      const body = Buffer.from(await response.arrayBuffer());
      expect(body.equals(content.subarray(0, 100))).toBe(true);
    });

    it('answers with an attachment Content-Disposition for downloads', async () => {
      const url = await storage.presignGetObject(key, {
        expiresIn: EXPIRES_IN,
        endpoint: 'public',
        downloadFileName: 'clip.mp4',
      });

      const response = await fetch(url, { headers: { Range: 'bytes=0-0' } });

      expect(response.headers.get('content-disposition')).toBe(
        'attachment; filename="clip.mp4"',
      );
    });

    it('stores objects written with putObject', async () => {
      const thumbnailKey = newKey();
      await storage.putObject(thumbnailKey, Buffer.from('jpeg'), 'image/jpeg');

      const url = await storage.presignGetObject(thumbnailKey, {
        expiresIn: EXPIRES_IN,
        endpoint: 'internal',
      });
      const response = await fetch(url);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/jpeg');
    });
  });

  describe('presign endpoints', () => {
    it('signs public URLs for S3_PUBLIC_ENDPOINT and internal URLs for S3_ENDPOINT', async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          StorageService,
          {
            provide: storageConfig.KEY,
            useValue: {
              endpoint: 'http://minio:9000',
              publicEndpoint: 'http://cdn.streamtube.test:9000',
              region: 'us-east-1',
              accessKey: 'key',
              secretKey: 'secret',
              bucket: 'streamtube',
            },
          },
        ],
      }).compile();
      const service = moduleRef.get(StorageService);

      const publicUrl = new URL(
        await service.presignGetObject('videos/a/source.mp4', {
          expiresIn: EXPIRES_IN,
          endpoint: 'public',
        }),
      );
      const internalUrl = new URL(
        await service.presignGetObject('videos/a/source.mp4', {
          expiresIn: EXPIRES_IN,
          endpoint: 'internal',
        }),
      );

      expect(publicUrl.host).toBe('cdn.streamtube.test:9000');
      expect(internalUrl.host).toBe('minio:9000');
      expect(publicUrl.pathname).toBe('/streamtube/videos/a/source.mp4');
    });
  });
});
