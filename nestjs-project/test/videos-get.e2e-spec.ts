import { INestApplicationContext } from '@nestjs/common';
import request from 'supertest';
import { Video } from '../src/videos/entities/video.entity';
import { VideoStatus } from '../src/videos/videos.constants';
import {
  VideosE2eContext,
  createVideosE2eApp,
  resetVideosE2eState,
  signUpAndLogin,
  startInProcessWorker,
  uploadFixture,
  waitForVideoStatus,
} from './helpers/videos-e2e';

// Spec: specs/videos-get.plan.md (SI-03.14)
describe('videos-get', () => {
  let context: VideosE2eContext;
  let worker: INestApplicationContext;
  let ownerToken: string;

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
    ownerToken = await signUpAndLogin(context, 'viewer@example.com');
  });

  // 1. Vídeo pronto acessível pela URL única

  it('retorna-metadados-do-video-pronto-sem-token', async () => {
    const { id, slug } = await uploadFixture(context, ownerToken);
    await waitForVideoStatus(context, id, VideoStatus.Ready);

    const res = await request(context.app.getHttpServer())
      .get(`/videos/${slug}`)
      .expect(200);

    expect(res.body.status).toBe('ready');
    expect(res.body.duration_seconds).toBeGreaterThan(2.9);
    expect(res.body.duration_seconds).toBeLessThan(3.1);
    expect(res.body.width).toBe(320);
    expect(res.body.height).toBe(240);
    expect(res.body.mime_type).toBe('video/mp4');
    expect(res.body.metadata.video_codec).toBe('h264');
    expect(res.body.channel.nickname).toBe('viewer');
    expect(res.body.thumbnail_url).toMatch(/^https?:\/\//);
  }, 90_000);

  it('thumbnail-url-entrega-jpeg', async () => {
    const { id, slug } = await uploadFixture(context, ownerToken);
    await waitForVideoStatus(context, id, VideoStatus.Ready);
    const res = await request(context.app.getHttpServer())
      .get(`/videos/${slug}`)
      .expect(200);

    const thumbnail = await fetch(res.body.thumbnail_url);

    expect(thumbnail.status).toBe(200);
    expect(thumbnail.headers.get('content-type')).toBe('image/jpeg');
    const bytes = Buffer.from(await thumbnail.arrayBuffer());
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  }, 90_000);

  it('uploads-com-mesmo-nome-recebem-urls-distintas', async () => {
    const first = await uploadFixture(context, ownerToken, 'sample.mp4');
    const second = await uploadFixture(context, ownerToken, 'sample.mp4');
    await waitForVideoStatus(context, first.id, VideoStatus.Ready);
    await waitForVideoStatus(context, second.id, VideoStatus.Ready);

    expect(first.slug).not.toBe(second.slug);
    const server = context.app.getHttpServer();
    const [resA, resB] = await Promise.all([
      request(server).get(`/videos/${first.slug}`).expect(200),
      request(server).get(`/videos/${second.slug}`).expect(200),
    ]);
    expect(resA.body.id).toBe(first.id);
    expect(resB.body.id).toBe(second.id);
  }, 90_000);

  // 2. Vídeos não prontos e slugs inexistentes

  it('video-nao-pronto-retorna-404', async () => {
    const created = await request(context.app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ file_name: 'draft.mp4', file_size: 1024, mime_type: 'video/mp4' })
      .expect(201);
    const { id, slug } = created.body as { id: string; slug: string };
    const videos = context.dataSource.getRepository(Video);

    for (const status of [
      VideoStatus.Draft,
      VideoStatus.Processing,
      VideoStatus.Failed,
    ]) {
      await videos.update({ id }, { status });
      const res = await request(context.app.getHttpServer())
        .get(`/videos/${slug}`)
        .expect(404);
      expect(res.body.error).toBe('VIDEO_NOT_FOUND');
    }
  });

  it('slug-inexistente-retorna-404', async () => {
    const res = await request(context.app.getHttpServer())
      .get('/videos/AAAAAAAAAAA')
      .expect(404);

    expect(res.body.error).toBe('VIDEO_NOT_FOUND');
  });
});
