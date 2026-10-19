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

// Spec: specs/videos-stream.plan.md (SI-03.15)
describe('videos-stream', () => {
  let context: VideosE2eContext;
  let worker: INestApplicationContext;
  let ownerToken: string;
  let fixture: UploadedFixture;
  let location: string;

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
    ownerToken = await signUpAndLogin(context, 'streamer@example.com');
  });

  // 1. Streaming por requisições parciais

  async function prepareReadyVideo(): Promise<void> {
    fixture = await uploadFixture(context, ownerToken);
    await waitForVideoStatus(context, fixture.id, VideoStatus.Ready);
    const res = await request(context.app.getHttpServer())
      .get(`/videos/${fixture.slug}/stream`)
      .redirects(0);
    location = res.headers.location;
  }

  it('redireciona-para-url-pre-assinada', async () => {
    await prepareReadyVideo();
    const res = await request(context.app.getHttpServer())
      .get(`/videos/${fixture.slug}/stream`)
      .redirects(0)
      .expect(302);

    const target = new URL(res.headers.location);
    expect(target.origin).toBe(
      new URL(process.env.S3_PUBLIC_ENDPOINT ?? 'http://minio:9000').origin,
    );
    expect(target.pathname).toContain(`videos/${fixture.id}/source.mp4`);
  }, 60_000);

  it('range-inicial-retorna-206', async () => {
    await prepareReadyVideo();
    const response = await fetch(location, {
      headers: { Range: 'bytes=0-1023' },
    });

    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(
      `bytes 0-1023/${fixture.bytes.length}`,
    );
    expect(response.headers.get('content-type')).toBe('video/mp4');
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.length).toBe(1024);
    expect(body.equals(fixture.bytes.subarray(0, 1024))).toBe(true);
  }, 60_000);

  it('range-no-meio-do-arquivo-retorna-somente-o-trecho', async () => {
    await prepareReadyVideo();
    const response = await fetch(location, {
      headers: { Range: 'bytes=2048-4095' },
    });

    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(
      `bytes 2048-4095/${fixture.bytes.length}`,
    );
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.length).toBe(2048);
    expect(body.equals(fixture.bytes.subarray(2048, 4096))).toBe(true);
  }, 60_000);

  // 2. Vídeo indisponível

  it('video-nao-pronto-retorna-404', async () => {
    const created = await request(context.app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ file_name: 'draft.mp4', file_size: 1024, mime_type: 'video/mp4' })
      .expect(201);

    const res = await request(context.app.getHttpServer())
      .get(`/videos/${created.body.slug}/stream`)
      .redirects(0)
      .expect(404);

    expect(res.body.error).toBe('VIDEO_NOT_FOUND');
  });
});
