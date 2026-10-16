---
libs:
  "bullmq":
    version: "^6.3.15"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-10-16T16:40:21-03:00"
  "@nestjs/bullmq":
    version: "^12.0.0"
    context7_id: "/nestjs/docs.nestjs.com"
    fetched_at: "2026-10-16T16:40:21-03:00"
  "@aws-sdk/client-s3":
    version: "^3.1152.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-16T16:40:21-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.1152.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-16T16:40:21-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-16T16:38:04-03:00"
---

# Library References — phase-03-videos

Distilled from Context7 (fetched over the Context7 HTTP API — the `context7` MCP server is not configured in this fork's `.mcp.json` for the current session). Versions are the latest published on npm at fetch time (`npm view <pkg> version`, 2026-10-16) and were cross-checked against the installed stack: `@nestjs/common@11.1.16`, `@nestjs/core@11.1.16`, Node `25.6.0`, CommonJS output.

## Compatibility notes

- `@nestjs/bullmq@12.0.0` peer dependencies: `bullmq ^3 || ^4 || ^5 || ^6`, `@nestjs/common ^10 || ^11 || ^12`, `@nestjs/core ^10 || ^11 || ^12` → compatible with the installed NestJS 11.
- `bullmq@6` uses `ioredis` internally (transitive) — no direct Redis client dependency needed.
- `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` must share the same minor version (both `3.1152.0`).
- Redis must run with `maxmemory-policy noeviction` for BullMQ (evicted keys corrupt queue state).

### bullmq

Used by: `phase-03-videos/TD-01`, `TD-06`, `TD-12`, `TD-13`.

**Adding a job with retries, backoff and a deterministic id** (`Queue.add(name, data, opts)`):

```typescript
await queue.add(
  'process-video',
  { videoId },
  {
    jobId: videoId,                                   // duplicates with the same jobId are ignored
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },     // 5s, 10s, 20s
    removeOnComplete: true,
    removeOnFail: false,
  },
);
```

- Source (`docs/gitbook/guide/jobs/job-ids.md` pattern): "jobs with the same `jobId` [are treated] as duplicates and only [the first is added] … if `removeOnComplete` or `removeOnFailed` is used, a removed job will not count as existing and a new job with the same ID could be added." → keep failed jobs (`removeOnFail: false`) so a duplicate `complete` call cannot re-enqueue a failed video silently; re-processing is a deliberate action.
- Custom job ids **must not contain `:`** (BullMQ key separator) — a UUID is safe.

**Stopping retries for permanent failures** (`docs/gitbook/patterns/stop-retrying-jobs.md`):

```typescript
import { UnrecoverableError } from 'bullmq';
throw new UnrecoverableError('No video stream found'); // moves job to failed, ignores remaining attempts
```

**Detecting the final failure** — in the `failed` worker event, a job is definitively failed when `job.attemptsMade >= (job.opts.attempts ?? 1)` or the error is an `UnrecoverableError`; only then the video status flips to `failed` (TD-12).

**Graceful shutdown** — `worker.close()` waits for the active job; `@nestjs/bullmq` calls it on application shutdown (`app.close()` / `enableShutdownHooks()`).

### @nestjs/bullmq

Used by: `phase-03-videos/TD-01`, `TD-06`.

**Root connection with injected config** (NestJS docs, `content/techniques/queues.md` → BullMQ):

```typescript
BullModule.forRootAsync({
  inject: [queueConfig.KEY],
  useFactory: (config: ConfigType<typeof queueConfig>) => ({
    connection: { host: config.redisHost, port: config.redisPort },
  }),
});
```

(Docs example injects `ConfigService` with `imports: [ConfigModule]`; the project convention injects the namespaced `registerAs` token instead — with `ConfigModule.forRoot({ isGlobal: true })` no `imports` is needed, per `.claude/rules/nestjs-testing.md` § forRootAsync.)

**Registering a queue / producer injection:**

```typescript
BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE });

constructor(@InjectQueue(VIDEO_PROCESSING_QUEUE) private readonly queue: Queue) {}
```

`getQueueToken(name)` returns the provider token (used by tests to fetch the `Queue` instance).

**Consumer:**

```typescript
@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessingProcessor extends WorkerHost {
  async process(job: Job<ProcessVideoJobData>): Promise<void> { … }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) { … }
}
```

Consumers must be registered as providers in a module that imports `BullModule.registerQueue({ name })`. A worker is created **only** in the process that registers the `@Processor` provider — the API process registers the queue (producer) but not the processor, so it never consumes jobs (TD-06).

### @aws-sdk/client-s3

Used by: `phase-03-videos/TD-02`, `TD-04`.

**Client for MinIO** — `new S3Client({ endpoint, region, credentials: { accessKeyId, secretAccessKey }, forcePathStyle: true })`. Path-style addressing (`http://minio:9000/<bucket>/<key>`) is required for MinIO because virtual-host style would resolve `<bucket>.minio`. The `forcePathStyle` option name is to be confirmed against the installed `S3ClientConfig` type definitions in the dependencies SI (Context7 snippets did not include the config reference page).

**Commands used** (all `client.send(new XCommand(input))`):

| Command | Input | Output used |
|---------|-------|-------------|
| `CreateMultipartUploadCommand` | `{ Bucket, Key, ContentType }` | `UploadId` |
| `UploadPartCommand` (presigned only) | `{ Bucket, Key, UploadId, PartNumber }` | — (client receives `ETag` header) |
| `ListPartsCommand` | `{ Bucket, Key, UploadId, PartNumberMarker? }` | `Parts[{ PartNumber, ETag, Size }]`, `IsTruncated`, `NextPartNumberMarker` (max 1000 per page) |
| `CompleteMultipartUploadCommand` | `{ Bucket, Key, UploadId, MultipartUpload: { Parts: [{ PartNumber, ETag }] } }` | — |
| `HeadObjectCommand` | `{ Bucket, Key }` | `ContentLength`, `ContentType` |
| `PutObjectCommand` | `{ Bucket, Key, Body, ContentType }` | — (thumbnail upload from worker) |
| `GetObjectCommand` (presigned only) | `{ Bucket, Key, ResponseContentDisposition?, ResponseContentType? }` | — |
| `DeleteObjectCommand` | `{ Bucket, Key }` | — (test cleanup) |

- `CompleteMultipartUpload` requires parts in ascending `PartNumber` order; each `ETag` must be the exact value (with quotes) returned by the part upload.
- Unknown/expired `UploadId` → `NoSuchUpload` error (`error.name === 'NoSuchUpload'`) — mapped to a domain exception (TD-15: storage expires stale uploads after 24h).
- Parts: 5 MiB minimum except the last, maximum 10,000 parts per upload.

### @aws-sdk/s3-request-presigner

Used by: `phase-03-videos/TD-02`, `TD-08`, `TD-11`.

```typescript
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const url = await getSignedUrl(client, new UploadPartCommand({ Bucket, Key, UploadId, PartNumber }), {
  expiresIn: 3600, // seconds; defaults to 900 when omitted
});
```

- SigV4 signs the `host` header: a URL signed with client endpoint `http://minio:9000` is only valid when requested on `minio:9000`. Presign with a second `S3Client` built from `S3_PUBLIC_ENDPOINT` (TD-04 dual endpoint); never rewrite the host of a signed URL.
- Download (TD-11): sign `GetObjectCommand` with `ResponseContentDisposition: 'attachment; filename="<name>"'` — the storage then answers with that `Content-Disposition` header. Streaming: sign a plain `GetObjectCommand`; S3/MinIO answer `Range` requests with `206 Partial Content` natively.
- Presigning is a local computation (no network call) — cheap to do per request.
