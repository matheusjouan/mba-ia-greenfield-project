import { INestApplicationContext } from '@nestjs/common';
import request from 'supertest';
import { VideoStatus } from '../src/videos/videos.constants';
import {
  UploadedFixture,
  VideosE2eContext,
  createVideosE2eApp,
  resetVideosE2eState,
  signUpAndLogin,
  startInProcessWorker,
  uploadFixture,
  waitForVideoStatus,
} from './helpers/videos-e2e';

// Spec: specs/videos-download.plan.md (SI-03.16)
describe('videos-download', () => {
  let context: VideosE2eContext;
  let worker: INestApplicationContext;
  let ownerToken: string;

  async function readyFixture(): Promise<UploadedFixture> {
    const fixture = await uploadFixture(context, ownerToken, 'sample.mp4');
    await waitForVideoStatus(context, fixture.id, VideoStatus.Ready);
    return fixture;
  }

  beforeAll(async () => {
    context = await createVideosE2eApp();
    worker = await startInProcessWorker();
  }, 60_000);

  afterAll(async () => {
    await worker?.close();
    await context?.app.close();
  });

  beforeEach(async () => {
    await resetVideosE2eState(context);
    ownerToken = await signUpAndLogin(context, 'downloader@example.com');
  });

  // 1. Download do arquivo original

  it('redireciona-para-url-de-download', async () => {
    const fixture = await readyFixture();

    const res = await request(context.app.getHttpServer())
      .get(`/videos/${fixture.slug}/download`)
      .redirects(0)
      .expect(302);

    expect(new URL(res.headers.location).origin).toBe(
      new URL(process.env.S3_PUBLIC_ENDPOINT ?? 'http://minio:9000').origin,
    );
  }, 60_000);

  it('storage-entrega-arquivo-completo-como-anexo', async () => {
    const fixture = await readyFixture();
    const res = await request(context.app.getHttpServer())
      .get(`/videos/${fixture.slug}/download`)
      .redirects(0)
      .expect(302);

    const response = await fetch(res.headers.location);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="sample.mp4"',
    );
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.length).toBe(fixture.bytes.length);
    expect(body.equals(fixture.bytes)).toBe(true);
  }, 60_000);

  // 2. Vídeo indisponível

  it('video-nao-pronto-retorna-404', async () => {
    const created = await request(context.app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ file_name: 'draft.mp4', file_size: 1024, mime_type: 'video/mp4' })
      .expect(201);

    const res = await request(context.app.getHttpServer())
      .get(`/videos/${created.body.slug}/download`)
      .redirects(0)
      .expect(404);

    expect(res.body.error).toBe('VIDEO_NOT_FOUND');
  });
});
