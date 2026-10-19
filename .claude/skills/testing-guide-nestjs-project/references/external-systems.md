> Part of the `testing-guide-nestjs-project` skill (see `../SKILL.md`).

# External System Strategies

How each external system is handled in tests. These strategies were confirmed with the team.

---

## PostgreSQL — Real (Docker)

**Strategy:** Real database via the Docker `db` service (already in `compose.yaml`).

**Connection config for tests:**
```typescript
{
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME ?? 'streamtube',
  password: process.env.DB_PASSWORD ?? 'streamtube',
  database: process.env.DB_DATABASE ?? 'streamtube',
  synchronize: true, // auto-create tables in test setup
}
```

**Test isolation:**
- Use `dataSource.query('DELETE FROM "table_name"')` to clean tables between tests
- Do NOT use `repository.delete({})` — throws `Empty criteria(s) are not allowed`
- Alternative: `repository.clear()` (truncates the table)
- For complex foreign key chains, delete in reverse dependency order or use `TRUNCATE ... CASCADE`
- Use `beforeEach` for cleanup to ensure each test starts with a clean state

**Entity setup:**
- Use `synchronize: true` in test DataSource to auto-create tables from entities
- For integration tests, import only the entities needed by the test — not all entities
- For E2E tests, import `AppModule` which includes all entities via their domain modules

---

## Object Storage — Real MinIO (Docker)

**Strategy:** Real S3-compatible storage via the Compose `minio` service (bucket provisioned by `minio-init`). Decided in Fase 03 (`phase-03-videos/TD-14`): the upload protocol (presigned multipart `UploadPart` URLs, `ListParts`, `CompleteMultipartUpload`) and streaming (HTTP `Range` → `206`) only exist on a real S3 API, so a local-filesystem adapter or an SDK mock would not test them. In production the same code talks to AWS S3.

**Approach:**
- `StorageService` (`src/storage/storage.service.ts`) is the only user of the AWS SDK; tests use it (or presigned URLs it returns) against MinIO — no mocking in integration/e2e tests.
- Use keys under a test prefix (e.g., `test/<suite>/<uuid>/...`) or the real layout `videos/<uuid>/...` with random ids, and delete created objects in `afterAll`. Abort multipart uploads you leave open (`abortMultipartUpload`); stale ones also expire after 24h.
- Client-side part uploads are plain `fetch(url, { method: 'PUT', body })` to the presigned URL; keep the `ETag` response header for completion.
- Media fixture for FFmpeg-based tests: `test/fixtures/sample.mp4`.

**Setup pattern:**
```typescript
const moduleRef = await Test.createTestingModule({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
    StorageModule,
  ],
}).compile();
const storage = moduleRef.get(StorageService);
```

**Integration test:**
```typescript
it('serves byte ranges with 206 Partial Content', async () => {
  await storage.putObject(key, content, 'video/mp4');
  const url = await storage.presignGetObject(key, { expiresIn: 300, endpoint: 'public' });

  const response = await fetch(url, { headers: { Range: 'bytes=0-99' } });

  expect(response.status).toBe(206);
});
```

---

## Message Queue — Real Redis + BullMQ (Docker)

**Strategy:** Real broker via the Compose `redis` service with BullMQ (`@nestjs/bullmq`), decided in Fase 03 (`phase-03-videos/TD-01`).

**Isolation from the running worker:** the `video-worker` Compose service consumes the default prefix `bull`. `src/test/jest-setup-env.ts` (first entry of `setupFiles`, before `dotenv/config`) sets `QUEUE_PREFIX=streamtube-test`, so every test queue/worker lives under its own prefix and the Compose worker never takes test jobs.

**Patterns:**
- Root connection: `BullModule.forRootAsync({ inject: [queueConfig.KEY], useFactory: bullRootOptions })` (`src/queues/bull-root.options.ts`).
- Publisher tests: get the queue with `moduleRef.get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE))`, `await queue.obliterate({ force: true })` in `beforeEach`, then assert with `queue.getJob(id)` / `getJobCounts()`.
- Consumer tests: call the processing service directly for business outcomes; to exercise real delivery, boot `WorkerModule` (`NestFactory.createApplicationContext`) or `startInProcessWorker()` from `test/helpers/videos-e2e.ts` and poll the DB until the expected status.
- Tests that open Redis or Postgres connections are `*.integration-spec.ts` (module compilation tests included). Always close the module/app in `afterAll` so Jest exits.

```typescript
it('enqueues a process-video job keyed by the video id', async () => {
  await producer.enqueue(videoId);

  const job = await queue.getJob(videoId);
  expect(job?.data).toEqual({ videoId });
});
```

---

## Email — Mailpit (Real SMTP Capture)

**Strategy:** Mailpit — a local SMTP server that captures all emails for inspection via its API. No emails are actually delivered.

**Setup:**
- Add Mailpit to `compose.yaml`:
```yaml
mailpit:
  image: axllent/mailpit
  ports:
    - "1025:1025"   # SMTP
    - "8025:8025"   # Web UI / API
```

**NestJS configuration:**
```typescript
// In mail module or config
{
  transport: {
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? 1025),
  },
}
```

**Integration test:**
```typescript
describe('MailService (integration)', () => {
  beforeEach(async () => {
    // Clear all captured emails via Mailpit API
    await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' });
  });

  it('should send confirmation email', async () => {
    await mailService.sendConfirmation('user@test.com', 'token-123');

    // Query Mailpit API for captured emails
    const response = await fetch('http://localhost:8025/api/v1/messages');
    const data = await response.json();

    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].To[0].Address).toBe('user@test.com');
    expect(data.messages[0].Subject).toContain('confirm');
  });
});
```

**Key points:**
- Mailpit captures ALL emails — no mocking, no side effects
- Use Mailpit's REST API (`http://localhost:8025/api/v1/messages`) to inspect sent emails
- Clear captured emails in `beforeEach` to ensure test isolation
- Web UI at `http://localhost:8025` for manual debugging
- Tests the full SMTP transport path — if the SMTP config is wrong, the test fails
