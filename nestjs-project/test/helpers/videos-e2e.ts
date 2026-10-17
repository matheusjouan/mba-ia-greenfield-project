import { INestApplication, ValidationPipe } from '@nestjs/common';
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
