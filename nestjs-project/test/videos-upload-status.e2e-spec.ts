import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { VideosService } from '../src/videos/videos.service';
import {
  MIB,
  VideosE2eContext,
  createVideosE2eApp,
  putPart,
  resetVideosE2eState,
  signUpAndLogin,
} from './helpers/videos-e2e';

// Spec: specs/videos-upload-status.plan.md (SI-03.9)
describe('videos-upload-status', () => {
  const PART_SIZE = 5 * MIB;
  let context: VideosE2eContext;
  let ownerToken: string;

  async function startUpload(
    fileSize: number,
  ): Promise<{ slug: string; parts: { part_number: number; url: string }[] }> {
    const res = await request(context.app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        file_name: 'clip.mp4',
        file_size: fileSize,
        mime_type: 'video/mp4',
      })
      .expect(201);
    return { slug: res.body.slug, parts: res.body.upload.parts };
  }

  beforeAll(async () => {
    context = await createVideosE2eApp({ uploadPartSizeBytes: PART_SIZE });
  });

  afterAll(async () => {
    await context.app.close();
  });

  beforeEach(async () => {
    await resetVideosE2eState(context);
    ownerToken = await signUpAndLogin(context, 'owner@example.com');
  });

  // 1. Retomada do upload pelo dono

  it('lista-partes-enviadas-e-urls-das-faltantes', async () => {
    const { slug, parts } = await startUpload(PART_SIZE + MIB);
    expect(parts).toHaveLength(2);
    const etag = await putPart(parts[0].url, randomBytes(PART_SIZE));

    const res = await request(context.app.getHttpServer())
      .get(`/videos/${slug}/upload`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(res.body.status).toBe('draft');
    expect(res.body.processing_error).toBeNull();
    expect(res.body.upload.uploaded_parts).toEqual([
      { part_number: 1, etag, size: PART_SIZE },
    ]);
    expect(res.body.upload.parts).toHaveLength(1);
    expect(res.body.upload.parts[0].part_number).toBe(2);
    expect(res.body.upload.parts[0].url).toMatch(/^https?:\/\//);
  });

  it('video-em-processing-nao-retorna-dados-de-upload', async () => {
    const { slug, parts } = await startUpload(MIB);
    const etag = await putPart(parts[0].url, randomBytes(MIB));
    // Same domain operation POST /videos/:slug/upload/complete performs (SI-03.10)
    const owner = await request(context.app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${ownerToken}`);
    await context.moduleRef
      .get(VideosService)
      .completeUpload(owner.body.sub, slug, [{ partNumber: 1, etag }]);

    const res = await request(context.app.getHttpServer())
      .get(`/videos/${slug}/upload`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(res.body.status).toBe('processing');
    expect(res.body.upload).toBeNull();
  });

  // 2. Acesso negado e recurso inexistente

  it('outro-usuario-recebe-404', async () => {
    const { slug } = await startUpload(MIB);
    const intruderToken = await signUpAndLogin(context, 'intruder@example.com');

    const res = await request(context.app.getHttpServer())
      .get(`/videos/${slug}/upload`)
      .set('Authorization', `Bearer ${intruderToken}`)
      .expect(404);

    expect(res.body.error).toBe('VIDEO_NOT_FOUND');
  });

  it('sem-token-retorna-401', async () => {
    const { slug } = await startUpload(MIB);

    await request(context.app.getHttpServer())
      .get(`/videos/${slug}/upload`)
      .expect(401);
  });

  it('slug-inexistente-retorna-404', async () => {
    const res = await request(context.app.getHttpServer())
      .get('/videos/AAAAAAAAAAA/upload')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);

    expect(res.body.error).toBe('VIDEO_NOT_FOUND');
  });
});
