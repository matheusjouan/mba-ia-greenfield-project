import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  INestApplication,
  INestApplicationContext,
  ValidationPipe,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import videoConfig from '../../src/config/video.config';
import { DomainExceptionFilter } from '../../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../../src/common/filters/validation-exception.filter';
import { MailService } from '../../src/mail/mail.service';
import { cleanAllTables } from '../../src/test/create-test-data-source';
import { Video } from '../../src/videos/entities/video.entity';
import { VideoStatus } from '../../src/videos/videos.constants';
import { WorkerModule } from '../../src/worker.module';

export const MIB = 1024 * 1024;

export interface VideosE2eContext {
  app: INestApplication<App>;
  moduleRef: TestingModule;
  dataSource: DataSource;
}

/** Boots AppModule with the global pipe/filters that main.ts registers. */
export async function createVideosE2eApp(
  videoOverrides: Partial<ReturnType<typeof videoConfig>> = {},
): Promise<VideosE2eContext> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(videoConfig.KEY)
    .useValue({ ...videoConfig(), ...videoOverrides })
    .compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(
    new DomainExceptionFilter(),
    new ValidationExceptionFilter(),
  );
  await app.init();

  return { app, moduleRef, dataSource: moduleRef.get(DataSource) };
}

/** Clears tables and the auth rate-limit counters between scenarios. */
export async function resetVideosE2eState(
  context: VideosE2eContext,
): Promise<void> {
  await cleanAllTables(context.dataSource);
  context.moduleRef
    .get<ThrottlerStorageService>(ThrottlerStorage)
    .storage.clear();
}

/** Registers, confirms and logs a user in through the real auth endpoints. */
export async function signUpAndLogin(
  context: VideosE2eContext,
  email: string,
  password = 'password123',
): Promise<string> {
  // AuthService sends the confirmation link through the singleton MailService
  const mailService = context.moduleRef.get(MailService);
  let confirmationToken = '';
  jest
    .spyOn(mailService, 'sendConfirmationEmail')
    .mockImplementationOnce((_email: string, _name: string, token: string) => {
      confirmationToken = token;
      return Promise.resolve();
    });

  const server = context.app.getHttpServer();
  await request(server).post('/auth/register').send({ email, password });
  await request(server)
    .get('/auth/confirm-email')
    .query({ token: confirmationToken });
  const login = await request(server)
    .post('/auth/login')
    .send({ email, password });

  return (login.body as { access_token: string }).access_token;
}

/** PUTs bytes to a presigned part URL, straight to the object storage. */
export async function putPart(url: string, body: Buffer): Promise<string> {
  const response = await fetch(url, {
    method: 'PUT',
    body: new Uint8Array(body),
  });
  if (response.status !== 200) {
    throw new Error(`Part upload failed with ${response.status}`);
  }
  return response.headers.get('etag')!;
}

export const FIXTURE_PATH = resolve(__dirname, '../fixtures/sample.mp4');

/**
 * The video worker booted in the test process. It consumes the test queue
 * prefix, so the `video-worker` compose service never takes these jobs.
 */
export async function startInProcessWorker(): Promise<INestApplicationContext> {
  return NestFactory.createApplicationContext(WorkerModule, { logger: false });
}

export interface UploadedFixture {
  id: string;
  slug: string;
  bytes: Buffer;
}

/** Full client flow: start the upload, PUT the fixture, complete it. */
export async function uploadFixture(
  context: VideosE2eContext,
  accessToken: string,
  fileName = 'sample.mp4',
): Promise<UploadedFixture> {
  const bytes = await readFile(FIXTURE_PATH);
  const server = context.app.getHttpServer();
  const created = await request(server)
    .post('/videos')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      file_name: fileName,
      file_size: bytes.length,
      mime_type: 'video/mp4',
    });
  const { id, slug, upload } = created.body as {
    id: string;
    slug: string;
    upload: { parts: { url: string }[] };
  };
  const etag = await putPart(upload.parts[0].url, bytes);
  await request(server)
    .post(`/videos/${slug}/upload/complete`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ parts: [{ part_number: 1, etag }] });
  return { id, slug, bytes };
}

export async function waitForVideoStatus(
  context: VideosE2eContext,
  videoId: string,
  status: VideoStatus,
  timeoutMs = 60_000,
): Promise<Video> {
  const videos = context.dataSource.getRepository(Video);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const video = await videos.findOneByOrFail({ id: videoId });
    if (video.status === status) return video;
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`Video ${videoId} did not reach status ${status}`);
}
