import { randomBytes } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import request from 'supertest';
import { VIDEO_PROCESSING_QUEUE } from '../src/queues/queues.constants';
import { Video } from '../src/videos/entities/video.entity';
import {
  MIB,
  VideosE2eContext,
  createVideosE2eApp,
  putPart,
  resetVideosE2eState,
  signUpAndLogin,
} from './helpers/videos-e2e';

// Spec: specs/videos-upload-complete.plan.md (SI-03.10)
describe('videos-upload-complete', () => {
  let context: VideosE2eContext;
  let queue: Queue;
  let ownerToken: string;
  let slug: string;
  let videoId: string;
  let etag: string;

  const complete = (token: string, body: unknown) =>
    request(context.app.getHttpServer())
      .post(`/videos/${slug}/upload/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

  const storedVideo = () =>
    context.dataSource.getRepository(Video).findOneByOrFail({ id: videoId });

  beforeAll(async () => {
    context = await createVideosE2eApp();
    queue = context.moduleRef.get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE));
  });

  afterAll(async () => {
    await context.app.close();
  });

  beforeEach(async () => {
    await resetVideosE2eState(context);
    await queue.obliterate({ force: true });
    ownerToken = await signUpAndLogin(context, 'owner@example.com');

    const res = await request(context.app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ file_name: 'clip.mp4', file_size: MIB, mime_type: 'video/mp4' })
      .expect(201);
    slug = res.body.slug;
    videoId = res.body.id;
    etag = await putPart(res.body.upload.parts[0].url, randomBytes(MIB));
  });

  // 1. Conclusão do upload e disparo do processamento

  it('conclui-upload-e-move-para-processing', async () => {
    const res = await complete(ownerToken, {
      parts: [{ part_number: 1, etag }],
    }).expect(200);

    expect(res.body).toEqual({
      id: videoId,
      slug,
      title: 'clip',
      status: 'processing',
    });
    const stored = await storedVideo();
    expect(stored.status).toBe('processing');
    expect(stored.upload_id).toBeNull();
    const job = await queue.getJob(videoId);
    expect(job?.name).toBe('process-video');
    expect(job?.data).toEqual({ videoId });
  });

  it('segunda-conclusao-retorna-409', async () => {
    await complete(ownerToken, { parts: [{ part_number: 1, etag }] }).expect(
      200,
    );

    const res = await complete(ownerToken, {
      parts: [{ part_number: 1, etag }],
    }).expect(409);

    expect(res.body.error).toBe('VIDEO_NOT_IN_DRAFT');
  });

  // 2. Rejeições

  it('etag-invalido-retorna-400-invalid-upload-parts', async () => {
    const res = await complete(ownerToken, {
      parts: [{ part_number: 1, etag: '"00000000000000000000000000000000"' }],
    }).expect(400);

    expect(res.body.error).toBe('INVALID_UPLOAD_PARTS');
    expect((await storedVideo()).status).toBe('draft');
  });

  it('lista-de-partes-vazia-retorna-400', async () => {
    const res = await complete(ownerToken, { parts: [] }).expect(400);

    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('outro-usuario-recebe-404', async () => {
    const intruderToken = await signUpAndLogin(context, 'intruder@example.com');

    const res = await complete(intruderToken, {
      parts: [{ part_number: 1, etag }],
    }).expect(404);

    expect(res.body.error).toBe('VIDEO_NOT_FOUND');
    expect((await storedVideo()).status).toBe('draft');
  });
});
