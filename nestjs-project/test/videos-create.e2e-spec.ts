import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { Video } from '../src/videos/entities/video.entity';
import {
  MIB,
  VideosE2eContext,
  createVideosE2eApp,
  putPart,
  resetVideosE2eState,
  signUpAndLogin,
} from './helpers/videos-e2e';

// Spec: specs/videos-create.plan.md (SI-03.8)
describe('videos-create', () => {
  let context: VideosE2eContext;
  let accessToken: string;

  const validBody = {
    file_name: 'clip.mp4',
    file_size: MIB,
    mime_type: 'video/mp4',
  };

  beforeAll(async () => {
    context = await createVideosE2eApp();
  });

  afterAll(async () => {
    await context.app.close();
  });

  beforeEach(async () => {
    await resetVideosE2eState(context);
    accessToken = await signUpAndLogin(context, 'creator@example.com');
  });

  // 1. Iniciar upload com pré-cadastro do rascunho

  it('cria-rascunho-e-retorna-urls-das-partes', async () => {
    const res = await request(context.app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBody)
      .expect(201);

    expect(res.body).toMatchObject({
      title: 'clip',
      status: 'draft',
      upload: { part_size: 104857600, part_count: 1 },
    });
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.slug).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(new Date(res.body.upload.expires_at).getTime()).toBeGreaterThan(
      Date.now(),
    );
    expect(res.body.upload.parts).toHaveLength(1);
    expect(res.body.upload.parts[0].part_number).toBe(1);
    expect(res.body.upload.parts[0].url).toMatch(/^https?:\/\//);

    const stored = await context.dataSource.getRepository(Video).findOneOrFail({
      where: { id: res.body.id },
      relations: { channel: { user: true } },
    });
    expect(stored.status).toBe('draft');
    expect(stored.upload_id).not.toBeNull();
    expect(stored.storage_key).toBe(`videos/${res.body.id}/source.mp4`);
    expect(stored.channel.user.email).toBe('creator@example.com');
  });

  it('url-da-parte-aceita-put-direto-no-storage', async () => {
    const res = await request(context.app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBody)
      .expect(201);

    const etag = await putPart(res.body.upload.parts[0].url, randomBytes(MIB));

    expect(etag).toBeTruthy();
  });

  // 2. Rejeições de entrada e autenticação

  it('sem-token-retorna-401', async () => {
    await request(context.app.getHttpServer())
      .post('/videos')
      .send(validBody)
      .expect(401);

    expect(await context.dataSource.getRepository(Video).count()).toBe(0);
  });

  it('mime-type-fora-da-allowlist-retorna-400', async () => {
    const res = await request(context.app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ...validBody, mime_type: 'image/png' })
      .expect(400);

    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body.message)).toContain('mime_type');
  });

  it('arquivo-acima-de-10gb-retorna-400', async () => {
    const res = await request(context.app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ...validBody, file_size: 10737418241 })
      .expect(400);

    expect(res.body.error).toBe('VIDEO_FILE_TOO_LARGE');
    expect(await context.dataSource.getRepository(Video).count()).toBe(0);
  });

  it('campo-desconhecido-retorna-400', async () => {
    const res = await request(context.app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ...validBody, status: 'ready' })
      .expect(400);

    expect(res.body.error).toBe('VALIDATION_ERROR');
  });
});
