# CLAUDE.md

## Environment Startup Verification

**Default behavior:** starting the environment means starting **only infrastructure services** (database, mail, etc.) — **never** start the NestJS application server unless the user explicitly asks to run/serve the project (e.g., "rode o projeto", "suba o servidor", "run the app").

After starting infrastructure, always confirm the containers are up before proceeding:

```bash
docker compose ps   # all services must show status "running"
```

Then verify each infrastructure service is actually ready to accept connections — not just running:

- **PostgreSQL:** `docker compose exec db pg_isready -U streamtube` — expect `accepting connections`
- **Redis (queue broker):** `docker compose exec redis redis-cli ping` — expect `PONG`
- **MinIO (object storage):** `docker compose ps minio` shows `healthy`, and `docker compose ps -a minio-init` shows `Exited (0)` (bucket `streamtube` provisioned)
- **Video worker:** `docker compose logs video-worker` contains `Video worker started, consuming video-processing` (the first `nest start --watch` compilation over the bind mount can take a few minutes)

The `video-worker` service is infrastructure (it is started by `docker compose up -d`); the API dev server is not.

Only start the NestJS dev server (`npm run start:dev`) when the user **explicitly** asks to run the application — never as part of "start the environment".

## Development Environment

This project runs inside Docker. Always use the container for development:

```bash
# Start containers
docker compose up -d

# Install dependencies (first time only)
docker compose exec nestjs-api npm install

# Run the dev server (watch mode)
docker compose exec nestjs-api npm run start:dev
```

Services:
- `nestjs-api` — NestJS API, port `3000` (container idles; the dev server is started on demand)
- `db` — PostgreSQL 17, port `5432`, database `streamtube`, user/password `streamtube`
- `mailpit` — SMTP `1025`, web UI `8025`
- `minio` — S3-compatible object storage (Chainguard MinIO image pinned by digest), API port `9000`, console `9001`, credentials `S3_ACCESS_KEY`/`S3_SECRET_KEY`; incomplete multipart uploads expire after 24h (`MINIO_API_STALE_UPLOADS_EXPIRY`)
- `minio-init` — one-shot `mc mb --ignore-existing` that creates the `S3_BUCKET` bucket
- `redis` — Redis 8 for BullMQ, port `6379`, `maxmemory-policy noeviction`
- `video-worker` — same image and code as the API, runs `npm run start:worker:dev` (`src/worker.ts`) and consumes the `video-processing` queue

On a fresh clone the worker starts before `node_modules` exists and keeps restarting (`restart: unless-stopped`) until `docker compose exec nestjs-api npm install` runs. On Windows/Docker Desktop the watch mode does not receive file events from the bind mount, so restart `video-worker` after changing worker code.

All verification and teardown commands run on the **host machine**:

```bash
# Verify NestJS is running (expect 200 + "Hello World!")
curl http://localhost:3000

# Verify PostgreSQL is ready (runs inside the db container)
docker compose exec db pg_isready -U streamtube

# Check container logs
docker compose logs nestjs-api
docker compose logs db

# Tear down the entire environment
docker compose down
```

## Commands

**Strict rule:** every `npm`, `npx`, `node`, `tsc`, and test command runs **inside the container**, never on the host. Running on the host causes env-var divergence (`DB_HOST` resolves to `localhost` instead of the Compose service), uses a different Node version, and produces results that do not reflect what runs in CI/prod.

### Container-only commands (always prefix with `docker compose exec nestjs-api`)

```bash
npm run start:dev                        # Dev server with hot-reload
npm run build                            # Compile to dist/
npm run start:prod                       # Run compiled build
npm run start:worker:dev                 # Video worker in watch mode (output in dist-worker/; the compose service runs it)
npm run build:worker                     # Compile the worker to dist-worker/
npm run start:worker                     # Run the compiled worker

npm test                                 # Unit tests
npm run test:watch                       # Unit tests in watch mode
npm run test:cov                         # Coverage report
npm run test:e2e                         # End-to-end tests (always with --runInBand)

npx tsc --noEmit                         # Type-check (required before declaring a task done)
npm run lint                             # ESLint with auto-fix
npm run format                           # Prettier formatting
```

### Host-only commands (Docker / connectivity probes)

```bash
docker compose ps
docker compose logs nestjs-api
docker compose exec db pg_isready -U streamtube
curl http://localhost:3000
```

### Test execution

Integration and e2e suites share a single test database. They **must** be run with `--runInBand`:

```bash
docker compose exec nestjs-api npm test -- --runInBand
docker compose exec nestjs-api npm run test:e2e   # already configured
```

Parallel execution causes FK violations, deadlocks, and cross-suite contamination because suites truncate or seed shared tables concurrently.

During active development, run only the tests related to the file being changed (`npm test -- path/to/file.spec.ts`). Before declaring a task done, run the full suite — see the global `CLAUDE.md` → "Definition of Done (Technical)".

## Long-running Processes

Commands that never exit (dev server, watch modes) must be run in background in the Bash tool — otherwise the agent blocks indefinitely waiting for the process to return.

This applies to: `start:dev`, `start:prod`, `test:watch`, and any other persistent process.

## Test Type Selection

Choose the suffix by what the test really does, not by where the code under test lives. The suffix is a contract that drives Jest config (`testRegex`, parallelism), CI steps, and reader expectations.

| Suffix                  | Purpose                                                              | DB / external I/O | Location                     |
|-------------------------|----------------------------------------------------------------------|-------------------|------------------------------|
| `*.spec.ts`             | **Unit** — pure logic, all collaborators mocked                      | Forbidden         | Next to the source file      |
| `*.integration-spec.ts` | **Integration** — exercises real DB, real repositories, real modules | Required          | Next to the source file      |
| `*.e2e-spec.ts`         | **End-to-end** — full HTTP cycle via `supertest`                     | Required          | `nestjs-project/test/`       |

A test that constructs a `TypeOrmModule.forRoot`, opens a connection, or hits the `db` service **must** be `*.integration-spec.ts`, never `*.spec.ts`. A test that boots the full Nest application and makes HTTP calls **must** be `*.e2e-spec.ts`.

Conventions for **how to write** each kind of test (mocking patterns, AAA structure, override strategies for global guards, etc.) live in `.claude/rules/nestjs-testing.md` and load when you edit a test file.

## Jest Configuration

These settings are required in `package.json` (jest config) and `test/jest-e2e.json` for the project's tests to work correctly:

- `setupFiles: ["<rootDir>/test/jest-setup-env.ts", "dotenv/config"]` (in `test/jest-e2e.json` the first entry is `<rootDir>/../src/test/jest-setup-env.ts`) — `dotenv/config` loads `.env` inside the Jest process (without it `DB_HOST`, `JWT_SECRET`, etc. fall back to undefined or to the host's `localhost`, breaking container-to-container DNS). `src/test/jest-setup-env.ts` must run **first**: it sets `QUEUE_PREFIX=streamtube-test`, and since `dotenv` never overrides variables already set, test jobs stay under their own BullMQ prefix instead of the `bull` prefix the `video-worker` service consumes.
- `testRegex: '.*\\.(spec|integration-spec)\\.ts$'` — covers both unit (`*.spec.ts`) and integration (`*.integration-spec.ts`) suffixes.

Do not add new test-file suffixes; if a new test type is needed, update the regex deliberately.

## Environment File Conventions

`.env` is parsed by both Docker Compose and `dotenv` — values containing shell-special characters (`<`, `>`, `|`, `&`, spaces) **must be quoted** or rewritten:

```dotenv
# Wrong — the unquoted angle brackets are shell redirection syntax and break parsing
MAIL_FROM=StreamTube <noreply@streamtube.local>

# Right — quote the value
MAIL_FROM="StreamTube <noreply@streamtube.local>"
```

Whenever possible, prefer storing only the bare address in `.env` and composing display names in code (e.g., in `mail.config.ts`) so the file stays shell-safe.

## Build Assets

`tsc` (and therefore `nest build`) only emits compiled `.ts` files to `dist/`. Any non-TypeScript runtime asset — Handlebars templates (`.hbs`), JSON fixtures, static config files, etc. — must be declared in `nest-cli.json` under `compilerOptions.assets` (with `watchAssets: true` for dev). Without that, the file exists in `src/` but is missing in `dist/` and runtime fails only after build.

## Architecture

NestJS with standard module structure. Source lives in `src/`, compiled output in `dist/`.

- Each domain feature gets its own module (e.g., `UsersModule`, `VideosModule`) registered in `AppModule`
- Controllers handle HTTP routing; Services hold business logic; both are scoped to their module
- Two entrypoints share the same code and root configuration: `src/main.ts` (HTTP API, `AppModule`) and `src/worker.ts` (video worker, `WorkerModule`, no HTTP server). Root options live in `src/config/config-module.options.ts`, `src/database/typeorm.options.ts` and `src/queues/bull-root.options.ts` — reuse them instead of duplicating connection settings.

## Videos (Fase 03)

Planning artifacts: `docs/phases/phase-03-videos/` (plan, progress) and decisions in `docs/decisions/technical-decisions-phase-03-videos.md`.

Modules:

| Module | Path | Responsibility |
|--------|------|----------------|
| `VideosModule` | `src/videos/` | `Video` entity (`videos` table), `VideosController`, `VideosService` (upload handshake, status transitions, public reads) |
| `StorageModule` | `src/storage/` | `StorageService` — the only user of the AWS S3 SDK: multipart upload, presigned part/GET URLs, objects; maps `NoSuchUpload` → `UPLOAD_EXPIRED` and invalid parts → `INVALID_UPLOAD_PARTS` |
| `QueuesModule` | `src/queues/` | `video-processing` queue registration and `VideoProcessingProducer` (job `process-video`, payload `{ videoId }`, `jobId = videoId`, 3 attempts, exponential backoff 5s) |
| `VideoWorkerModule` | `src/video-worker/` | Imported **only** by `WorkerModule`: `VideoProcessingProcessor` (BullMQ consumer), `VideoProcessingService`, `MediaProbeService` (spawns `ffprobe`/`ffmpeg`) |

Endpoints (`VideosController`, `@Controller('videos')`, snake_case JSON):

| Endpoint | Access | Purpose |
|----------|--------|---------|
| `POST /videos` | Authenticated | Pre-registers a `draft` in the caller channel, opens an S3 multipart upload and returns one presigned `PUT` URL per part. The file goes straight to MinIO — never through the API |
| `GET /videos/:slug/upload` | Owner | Pipeline state; while `draft`, the uploaded parts and fresh URLs for the missing ones (resume) |
| `POST /videos/:slug/upload/complete` | Owner | Completes the multipart upload, checks the stored size, sets `processing` and enqueues the job |
| `GET /videos/:slug` | Public (`@Public()`) | Metadata of a `ready` video + presigned `thumbnail_url` |
| `GET /videos/:slug/stream` | Public | `302` to a presigned GET URL; MinIO answers `Range` requests with `206 Partial Content` |
| `GET /videos/:slug/download` | Public | `302` to a presigned GET URL signed with `Content-Disposition: attachment` |

Non-owners get `404 VIDEO_NOT_FOUND` on owner endpoints; public endpoints only see `ready` videos.

Status lifecycle (`VideoStatus` in `src/videos/videos.constants.ts`): `draft` (upload started) → `processing` (upload completed, job enqueued — API) → `ready` (metadata + thumbnail persisted — worker) | `failed` (size mismatch or enqueue failure in the API; last failed attempt or unreadable media in the worker, reason in `processing_error`). Worker transitions only update rows still in `processing`, so retries and duplicate jobs are idempotent.

Storage layout (`src/videos/video-storage-keys.ts`): `videos/{videoId}/source{.ext}` and `videos/{videoId}/thumbnail.jpg` in the private `S3_BUCKET`. The worker reads the source through an internal presigned URL (`S3_ENDPOINT`), so FFmpeg fetches only the byte ranges it needs. URLs handed to clients are signed for `S3_PUBLIC_ENDPOINT` (SigV4 signs the host — never rewrite it); it defaults to `S3_ENDPOINT` (`http://minio:9000`), which is reachable from inside the Compose network.

Unique URL: `slug` — 11 base64url chars from `node:crypto` (`src/videos/video-slug.util.ts`), unique index, regenerated on collision.

Testing notes:
- Storage, queue and FFmpeg are exercised for real (MinIO, Redis and the binaries in the `nestjs-api` image) — do not mock them in integration/e2e tests. The fixture `test/fixtures/sample.mp4` (3 s, 320x240, H.264 + AAC) feeds media tests.
- Video e2e tests share `test/helpers/videos-e2e.ts`: app bootstrap with the `main.ts` pipe/filters, login through the auth endpoints, direct part uploads, an in-process worker (`startInProcessWorker`) and `waitForVideoStatus`. Hooks that boot API + worker need a `60_000` timeout.
- Override video limits with `overrideProvider(videoConfig.KEY)` (e.g., 5 MiB parts) — never by mutating `process.env`, which leaks across files under `--runInBand`.
- With `autoLoadEntities`, a module graph only knows entities registered by imported modules: test data sources must list `Video` alongside `Channel`, and `WorkerModule` imports `UsersModule` because `Channel` references `User`.
- E2E scenarios are specified in `nestjs-project/specs/videos-*.plan.md` (one spec per endpoint → one `test/videos-*.e2e-spec.ts`).

## Code Conventions

- **TypeScript:** `nodenext` module resolution, `ES2023` target, `strictNullChecks` on, `noImplicitAny` off
- **Decorators:** `emitDecoratorMetadata` + `experimentalDecorators` enabled — required for NestJS DI
- **Prettier:** single quotes, trailing commas everywhere
- **ESLint:** `no-explicit-any` allowed; `no-floating-promises` and `no-unsafe-argument` are warnings. Test files (`*.spec.ts`, `*.integration-spec.ts`, `*.e2e-spec.ts`) turn off `no-unsafe-assignment`, `no-unsafe-member-access`, `no-unsafe-return` and `unbound-method` (supertest bodies and Jest mock handles are untyped); production code keeps the full type-checked rule set

## REST Conventions

This is a RESTful API. All endpoints must follow standard REST conventions — correct HTTP methods, proper status codes, plural resource nouns, and consistent URL structure. Details are enforced via rules on controller files.
