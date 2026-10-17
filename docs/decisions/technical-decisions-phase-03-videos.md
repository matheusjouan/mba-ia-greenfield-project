---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-10-16
scope_description: "Backend foundation for video upload and processing: message queue technology, direct-to-storage resumable upload of files up to 10GB, object storage layout and container image, video worker runtime, FFmpeg integration and media access, thumbnail policy, unique video URL, streaming/download delivery, status lifecycle with failure handling, job contract, and infra-backed testing."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — backend that delivers the `videos` module (upload handshake, status, streaming/download endpoints), the object storage integration, the processing queue producer, the video worker entrypoint (FFmpeg), the `videos` table migration, and the new Compose services (object storage, queue broker, worker).
- `next-frontend/` — no open decision in this document. Phase 03 capabilities in `docs/project-plan.md` contain no UI bullet (the watch page and player are Fase 05, the management panel is Fase 04). The cross-layer TDs below (TD-02, TD-10) define the HTTP handshake the frontend will consume later; no frontend code is written in this phase.

_Installed stack constraints (from `nestjs-project/package-lock.json`):_ `@nestjs/common@11.1.16`, `@nestjs/core@11.1.16`, `@nestjs/config@4.0.3`, `typeorm@0.3.28`, `typescript@^5.7`, Node `25.6.0` (`Dockerfile.dev`). CommonJS output (`module: nodenext`, no `"type": "module"`), so ESM-only libraries cannot be `require`d without dynamic `import()`.

---

## TD-01: Message Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The architecture diagram (`docs/diagrams/software-arch.mermaid`) declares a `Message Queue` container with technology `TBD` that delivers jobs from the API to the Video Worker. Processing a video (probe + thumbnail) is slow and must not block the HTTP request that completes the upload. The queue must support retries with backoff, a separate consumer process, and observable job state. This is the main open stack decision of the phase.

**Options:**

### Option A: BullMQ + Redis (`bullmq` + `@nestjs/bullmq`)
- Redis-backed job queue. `@nestjs/bullmq` provides `BullModule.forRootAsync`/`registerQueue`, `@InjectQueue()` for producers and `@Processor()` + `WorkerHost` for consumers. Jobs support `attempts`, `backoff` (exponential), custom `jobId` (deduplication), `UnrecoverableError`, concurrency and lifecycle events.
- **Pros:** Official NestJS integration (`@nestjs/bullmq@12` peer-supports `@nestjs/common ^11`). Retries/backoff/failed-set built in — matches the failure handling needed by TD-11. Redis is a lightweight new container that maps 1:1 to the diagram's separate `Message Queue` box. Worker can run in a separate process using the same decorators.
- **Cons:** Adds a new infrastructure service (Redis) with its own persistence/memory config (`maxmemory-policy noeviction` required). Two new dependencies.

### Option B: pg-boss (PostgreSQL-backed queue)
- Uses PostgreSQL tables + `SKIP LOCKED` as the queue. No new container; jobs live in the existing `db`.
- **Pros:** Zero new infrastructure. Transactional enqueue in the same DB as the `videos` row is possible.
- **Cons:** No official NestJS module (manual provider wiring and lifecycle). Merges the `Message Queue` and `Database` containers of the architecture diagram, contradicting the C4 design. Polling-based delivery adds latency and DB load as job volume grows.

### Option C: RabbitMQ (`amqplib` / `@nestjs/microservices` RMQ transport)
- AMQP broker with durable queues; NestJS microservices transport exposes `@EventPattern` handlers.
- **Pros:** Mature broker, strong delivery guarantees, protocol-level acknowledgements, good for multi-language consumers.
- **Cons:** Retries with exponential backoff require dead-letter exchanges + TTL plumbing (not built in). Heavier container. `@nestjs/microservices@12` targets NestJS 12 — version alignment with the installed NestJS 11 needs care. More moving parts than the phase needs.

**Recommendation:** **Option A (BullMQ + Redis)** — It is the only option with an official NestJS 11–compatible module that delivers retries/backoff/deduplication out of the box (needed by TD-11 and TD-12), while keeping the queue as a separate container exactly as the C4 diagram prescribes; pg-boss would save one container but merge the queue into the database, and RabbitMQ requires hand-built retry topology for no benefit at the current single-consumer scale.

**Decision:** A (BullMQ + Redis)

**Libraries:** `bullmq@^6.x`, `@nestjs/bullmq@^11.x`, `ioredis@^5.x`

**Revisions:**
- 2026-10-16 — `@nestjs/bullmq` pinned to `^11.x` (was `^12.x`) and `ioredis@^5.x` added as a direct dependency. Rationale: `@nestjs/bullmq@12.0.0` is ESM-only (`"type": "module"`) and targets NestJS 12 — it cannot be loaded by the CommonJS Jest runtime, while `11.0.5` is CommonJS with peer `@nestjs/common ^10 || ^11`; `bullmq@6` declares `ioredis` as an optional peer (not transitive), and `typeorm@0.3.28` restricts the optional peer to `ioredis@^5`. Found while implementing SI-03.6.

---

## TD-02: Large File Upload Strategy (up to 10GB)

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** Files up to 10GB must be uploaded without degrading the API. `docs/project-plan.md` (§ Pontos de Atenção) also requires the upload to **resume after a connection failure**. The protocol defines the handshake on both sides: the backend endpoints and the client sequence the frontend will implement later. Depends on TD-04 (storage layout).

**Options:**

### Option A: Direct-to-storage S3 Multipart Upload with presigned part URLs
- API creates the draft video and calls `CreateMultipartUpload`; it returns presigned `UploadPart` URLs (`@aws-sdk/s3-request-presigner` `getSignedUrl`). The client `PUT`s each part directly to the object storage, collects `ETag`s, then calls the API to `CompleteMultipartUpload`. Resume = API calls `ListParts` and re-signs URLs only for missing parts.
- **Pros:** File bytes never touch the API — zero API memory/CPU/bandwidth per upload. Native S3 protocol (works identically on MinIO and AWS S3). Resumable per part; parts can upload in parallel. Presigned URLs expire, limiting abuse.
- **Cons:** Client orchestrates the parts (more frontend logic). Bucket must accept the browser's origin (CORS) and the presigned host must be reachable by the client (see TD-04). Declared size must be re-validated after completion (`HeadObject`).

### Option B: tus resumable protocol (tus server in the API process or sidecar, S3 store)
- A tus server (`@tus/server` + `@tus/s3-store`) receives `PATCH` chunks and forwards them to S3 multipart.
- **Pros:** Standard resumable protocol with mature clients (`tus-js-client`, Uppy).
- **Cons:** Every byte flows through the API (or an extra sidecar) — 10GB of bandwidth and stream handling per upload on the server, which is exactly the load the capability forbids. Extra protocol layer on top of S3 multipart.

### Option C: Streamed `multipart/form-data` through the API (busboy → S3 `Upload`)
- API streams the request body to S3 (`@aws-sdk/lib-storage` `Upload`) without buffering to disk.
- **Pros:** Simplest client (single form POST). No CORS on storage.
- **Cons:** API holds a connection and a stream for the full duration of a 10GB transfer. Not resumable — a dropped connection restarts from zero, violating the § Pontos de Atenção requirement.

**Recommendation:** **Option A (S3 Multipart with presigned part URLs)** — It is the only option where the 10GB payload bypasses the API entirely while satisfying resumability through `ListParts`; it uses the S3 API that both MinIO (dev) and AWS S3 (prod) implement, so no extra server component is introduced. The frontend cost (part orchestration) is deferred to the phase that builds the upload UI.

**Decision:** A (S3 Multipart Upload with presigned part URLs)

**Libraries:** `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x`

---

## TD-03: Upload Limits and Part Sizing Policy

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** The 10GB ceiling, the part size, accepted media types and presigned URL lifetime are values shared by the env schema, the API validation, the storage calls and the frontend client. S3 constraints: parts between 5 MiB and 5 GiB (last part may be smaller), at most 10,000 parts. Depends on TD-02.

**Options:**

### Option A: Fixed, env-configurable part size (default 100 MiB) + 10 GiB max + MIME allowlist
- `VIDEO_MAX_FILE_SIZE_BYTES=10737418240`, `VIDEO_UPLOAD_PART_SIZE_BYTES=104857600` (≤ 103 parts for 10 GiB), `VIDEO_UPLOAD_URL_EXPIRATION_SECONDS=3600`; accepted MIME types `video/mp4`, `video/webm`, `video/quicktime`, `video/x-matroska`. Part count = `ceil(fileSize / partSize)`.
- **Pros:** Predictable, small number of URLs per upload; one knob to tune. Easy to validate and test.
- **Cons:** A fixed 100 MiB part means a failed part costs up to 100 MiB of re-upload on very slow links.

### Option B: Adaptive part size computed from file size
- `partSize = max(5 MiB, ceil(fileSize / 10000))` — always the minimum legal part.
- **Pros:** Smallest possible re-upload unit for each file.
- **Cons:** 10GB file → 2,048 parts of 5 MiB, i.e., 2,048 presigned URLs and request round-trips; more client orchestration and more `ListParts` pagination.

### Option C: Client-chosen part size within S3 bounds
- Client sends its preferred part size; API validates bounds.
- **Pros:** Flexibility for different client networks.
- **Cons:** Pushes a server-side policy to the client; harder to test and reason about; no benefit for a single first-party frontend.

**Recommendation:** **Option A** — A fixed 100 MiB default keeps a 10GB upload at ~103 parts (cheap to sign and to list on resume) while remaining configurable per environment; the MIME allowlist plus post-completion `HeadObject` size check enforces the 10 GiB ceiling server-side even though bytes bypass the API.

**Decision:** A (fixed env-configurable 100 MiB parts, 10 GiB max, MIME allowlist)

---

## TD-04: Object Storage Layout, Provisioning and Presigned Endpoint

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** The storage technology is given (S3-compatible: MinIO in Docker for dev, AWS S3 in prod). What is open is how it is used: bucket/key organization, who creates the bucket, and which host presigned URLs embed. The API talks to storage via the Compose service name (`minio:9000`, per `CLAUDE.md` § Docker Networking), but presigned URLs are consumed by the client; SigV4 signs the `Host` header, so the URL host cannot be rewritten after signing.

**Options:**

### Option A: Single private bucket, per-video key prefix, init container, dual endpoint
- One private bucket (`S3_BUCKET`, default `streamtube`). Keys: `videos/{videoId}/source{.ext}` and `videos/{videoId}/thumbnail.jpg`. Bucket created by a one-shot `minio-init` Compose service (`mc mb --ignore-existing`). Two S3 clients: internal (`S3_ENDPOINT=http://minio:9000`) for API/worker operations and a presign client (`S3_PUBLIC_ENDPOINT`, defaulting to `S3_ENDPOINT`) for URLs handed to clients.
- **Pros:** All artifacts of a video share one prefix (easy cleanup/lifecycle in later phases). Bucket stays private; every access is via short-lived presigned URLs. Provisioning lives in infra, not in app code (prod buckets are provisioned by infra too). Presign host is configurable without code changes.
- **Cons:** One extra short-lived Compose service. The public endpoint must be set to a client-reachable host when a browser consumes it (not needed in this backend-only phase).

### Option B: Two buckets (`videos` private, `thumbnails` public-read)
- Thumbnails served by plain public URLs; videos via presigned URLs.
- **Pros:** Thumbnail URLs are permanent and cacheable.
- **Cons:** Public bucket policy weakens privacy for future unlisted videos (Fase 04). Two buckets to provision and configure. Artifacts of a video scattered across buckets.

### Option C: App creates the bucket on boot (`HeadBucket`/`CreateBucket` in `onModuleInit`)
- Same layout as A, but provisioning in application code.
- **Pros:** No init container.
- **Cons:** Requires `s3:CreateBucket` permission for the app credentials in prod; mixes infra provisioning into the domain service; race between API and worker on first boot.

**Recommendation:** **Option A** — A single private bucket with a per-video prefix keeps every artifact behind presigned URLs (compatible with Fase 04 unlisted visibility), keeps provisioning in infrastructure where prod will also put it, and the dual endpoint isolates the one place where the client-facing host differs from the Compose service name.

**Decision:** A (single private bucket, per-video prefix, minio-init container, dual endpoint)

**Libraries:** `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x`

---

## TD-05: Object Storage Container Image

**Scope:** Repo-wide

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** MinIO is the expected local S3 implementation, but MinIO stopped publishing community images: `docker pull minio/minio` now fails with `pull access denied` (verified on 2026-10-16), and `quay.io/minio/minio` is frozen on a September 2025 build and now returns `401 Unauthorized` without login (verified on 2026-10-16). The Compose file needs a pullable, maintained S3-compatible image.

**Options:**

### Option A: Chainguard MinIO images (`cgr.dev/chainguard/minio`, `cgr.dev/chainguard/minio-client`)
- Free-tier images rebuilt from MinIO source; `latest` resolves to `RELEASE.2026-09-22T19-25-18Z` (verified). Same CLI/env (`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`) as upstream; includes a shell for healthchecks.
- **Pros:** Pullable without auth; current release including post-2025 security fixes; drop-in replacement for upstream MinIO commands.
- **Cons:** Free tier exposes only `latest` (pin by digest for reproducibility); depends on a third-party vendor.

### Option B: Build MinIO from source in the repo (custom Dockerfile)
- **Pros:** Full control over version.
- **Cons:** Go toolchain build in the dev setup; slow first `compose up`; maintenance burden on the project.

### Option C: Different S3-compatible server (e.g., Garage, SeaweedFS)
- **Pros:** Actively published images.
- **Cons:** Diverges from the MinIO choice stated in the architecture diagram; partial S3 API coverage (multipart/presign behaviour must be revalidated); different provisioning tooling.

**Recommendation:** **Option A (Chainguard MinIO, pinned by digest)** — It keeps MinIO as the diagram prescribes with an image that pulls today and carries current fixes; pinning by digest addresses the `latest`-only limitation, and since the app only speaks the S3 API, swapping the image later costs one Compose line.

**Decision:** A (Chainguard MinIO images pinned by digest)

---

## TD-06: Video Worker Runtime and Deployment

**Scope:** Backend

**Capability:** Transversal — covers: Serviço de processamento em segundo plano (filas); Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** The C4 diagram defines a separate `Video Worker (FFmpeg)` container that consumes the queue, reads/writes storage and updates the DB. The worker needs the `Video` entity, the storage client and the queue consumer — the same building blocks the API uses. Depends on TD-01.

**Options:**

### Option A: Same NestJS codebase, separate entrypoint and Compose service
- `src/worker.ts` boots `NestFactory.createApplicationContext(WorkerModule)` (no HTTP server) registering the BullMQ `@Processor`. A `video-worker` Compose service runs it from the same dev image (FFmpeg installed in `Dockerfile.dev`).
- **Pros:** Reuses entities, config namespaces, storage service and conventions without duplication or a shared package. Independent process/container scaling exactly as the diagram shows. One test runner and one lint/tsc pass.
- **Cons:** Worker image carries API dependencies it does not use. Requires a second build/start script.

### Option B: Processor inside the API process
- Register the `@Processor` in the API `AppModule`.
- **Pros:** No extra container or entrypoint.
- **Cons:** CPU-heavy FFmpeg runs compete with HTTP handling — the very coupling the queue exists to remove. Contradicts the diagram's separate worker container.

### Option C: Standalone worker subproject (new `video-worker/` package or another language)
- **Pros:** Minimal image; technology freedom.
- **Cons:** Duplicates entity/config/storage code or requires introducing shared packages (monorepo tooling decision outside this phase). Second test/lint toolchain.

**Recommendation:** **Option A** — A second entrypoint over the same codebase delivers the diagram's isolated worker container while reusing the `Video` entity, config and storage module; Option B reintroduces the API blocking the phase is meant to avoid, and Option C buys image size at the cost of duplication the project does not need yet.

**Decision:** A (same NestJS codebase, separate entrypoint and Compose service)

**Libraries:** `bullmq@^6.x`, `@nestjs/bullmq@^11.x` (see TD-01 Revisions)

---

## TD-07: FFmpeg Integration Approach

**Scope:** Backend

**Capability:** Transversal — covers: Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** Metadata extraction (duration, resolution, codecs, bitrate) and thumbnail generation require FFmpeg/ffprobe binaries. The Node wrapper historically used, `fluent-ffmpeg`, is marked deprecated on npm ("Package no longer supported", last modified 2025-05-22 — verified 2026-10-16). Depends on TD-06.

**Options:**

### Option A: Spawn `ffprobe`/`ffmpeg` directly via `node:child_process`
- `ffprobe -v error -print_format json -show_format -show_streams <input>` parsed into a typed result; `ffmpeg -ss <t> -i <input> -frames:v 1 ...` for the thumbnail. Binaries installed from Debian packages in the image.
- **Pros:** Zero npm dependencies; JSON output is a stable contract; full control over arguments and timeouts; easy to test against a real fixture.
- **Cons:** Small amount of glue code (spawn, exit-code handling, stderr capture).

### Option B: `fluent-ffmpeg`
- **Pros:** Familiar fluent API.
- **Cons:** Deprecated and unsupported; adds a dead dependency to a greenfield project.

### Option C: `ffmpeg.wasm`
- **Pros:** No native binaries.
- **Cons:** Much slower; in-memory file system unsuitable for multi-GB inputs.

**Recommendation:** **Option A** — Direct spawning of the official binaries with ffprobe's JSON output gives a stable, dependency-free contract; the only maintained-looking wrapper is deprecated and wasm cannot handle 10GB inputs.

**Decision:** A (spawn ffprobe/ffmpeg directly via node:child_process)

---

## TD-08: Worker Media Access Strategy

**Scope:** Backend

**Capability:** Transversal — covers: Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** The worker must read a source object of up to 10GB to probe it and grab one frame. Downloading the whole object is costly in disk and time. Depends on TD-04 and TD-07.

**Options:**

### Option A: Pass a short-lived presigned GET URL (internal endpoint) as FFmpeg input
- ffprobe/ffmpeg read over HTTP using Range requests; input seeking (`-ss` before `-i`) fetches only the bytes around the target frame.
- **Pros:** No local copy of the 10GB file; ffprobe reads only headers/index; constant disk usage in the worker.
- **Cons:** Files with the `moov` atom at the end (non-faststart MP4) make ffprobe issue an extra ranged read — still far smaller than a full download.

### Option B: Download the full object to a temp file, then process locally
- **Pros:** Simplest mental model; local seeks.
- **Cons:** Up to 10GB of disk and transfer per job before any work starts; temp-file cleanup on failure.

### Option C: Pipe the S3 `GetObject` body into FFmpeg stdin
- **Pros:** No temp file.
- **Cons:** Pipes are not seekable — MP4 with `moov` at the end cannot be probed, and seeking to a frame requires reading everything before it.

**Recommendation:** **Option A** — Presigned HTTP input lets FFmpeg's own range-aware demuxers read only what they need, keeping the worker's disk usage constant regardless of file size; full download wastes up to 10GB per job and stdin piping breaks on non-faststart files.

**Decision:** A (presigned GET URL as FFmpeg input)

**Libraries:** `@aws-sdk/s3-request-presigner@^3.x`

---

## TD-09: Thumbnail Generation Policy

**Scope:** Backend

**Capability:** Geração automática de thumbnail a partir de um frame do vídeo

**Context:** Which frame becomes the thumbnail, its format and size. Custom thumbnails are Fase 04 — this phase only generates the automatic one. Depends on TD-07/TD-08.

**Options:**

### Option A: Frame at 10% of duration, JPEG, scaled to max 1280px wide
- `ffmpeg -ss <duration*0.1> -i <input> -frames:v 1 -vf "scale='min(1280,iw)':-2" -q:v 3 thumbnail.jpg`.
- **Pros:** Skips black intro frames typical at t=0; fast input seek; bounded output size.
- **Cons:** May still hit a transition frame.

### Option B: Fixed offset (e.g., 1s, fallback 0 for very short videos)
- **Pros:** Simplest.
- **Cons:** Frequently picks fades/black frames at the very beginning.

### Option C: FFmpeg `thumbnail` filter (most representative frame among N)
- **Pros:** Better visual pick.
- **Cons:** Decodes a batch of consecutive frames — slower and reads more data over HTTP for large files.

**Recommendation:** **Option A** — 10% of duration avoids black intros at the same cost as a fixed offset, and the scale cap keeps thumbnails light for listing pages in later phases.

**Decision:** A (frame at 10% of duration, JPEG, max 1280px wide)

---

## TD-10: Unique Video URL Identifier

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** `docs/project-plan.md` (§ Pontos de Atenção) requires a **short** URL per video that never conflicts. The identifier appears in every public video route and later in frontend routes. Must be unguessable enough to support unlisted videos (Fase 04/05).

**Options:**

### Option A: Expose the UUID primary key
- **Pros:** Already unique; no extra column.
- **Cons:** 36 characters — not short; leaks the internal PK format.

### Option B: Random 11-character base64url slug (`crypto.randomBytes`) + unique index + retry on collision
- 11 chars × 6 bits = 66 bits of entropy (YouTube-style). Generated with `node:crypto`; a `UNIQUE` constraint guarantees no conflict and the service retries generation on a unique violation.
- **Pros:** Short, URL-safe, unguessable (fits unlisted links); no dependency; uniqueness enforced by the database, not by probability.
- **Cons:** Extra column/index; retry path (astronomically rare) must be implemented.

### Option C: Sqids/Hashids encoding of a sequential integer
- **Pros:** Short, deterministic, collision-free by construction.
- **Cons:** Requires a sequence column alongside the UUID PK; IDs are enumerable/decodable — unsuitable for unlisted videos.

### Option D: `nanoid` library
- **Pros:** Popular, well-tested generator.
- **Cons:** Current major (`nanoid@6`) is ESM-only — incompatible with the project's CommonJS output without dynamic import; adds a dependency for what `crypto.randomBytes` + base64url already provides.

**Recommendation:** **Option B** — An 11-char base64url slug from `node:crypto` is short and unguessable (required for future unlisted links) while the database unique index makes "never conflicts" a guarantee rather than a probability; Sqids is enumerable and nanoid is ESM-only.

**Decision:** B (11-char base64url slug via node:crypto + unique index + retry)

---

## TD-11: Streaming and Download Delivery

**Scope:** Cross-layer

**Capability:** Transversal — covers: Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário

**Context:** Playback must start without downloading the whole file, and users must be able to download it. The C4 diagram has `Frontend → Object Storage: Streams (HTTPS)`, i.e., bytes flow from storage to the client, not through the API. The client (HTML5 `<video>`) relies on HTTP Range requests and `206 Partial Content`. Depends on TD-04 and TD-10.

**Options:**

### Option A: API resolves the slug and redirects (`302`) to a short-lived presigned GET URL
- `GET /videos/:slug/stream` → `302 Location: <presigned GET>`; S3/MinIO serves Range requests with `206 Partial Content` natively. `GET /videos/:slug/download` → `302` to a presigned GET with `ResponseContentDisposition: attachment; filename="..."`.
- **Pros:** Matches the diagram (storage streams to the client); zero API bandwidth; Range/seek handled by the storage (and later a CDN). Same mechanism serves download with a forced attachment header.
- **Cons:** Presigned URL expiry must exceed a typical viewing session (configurable `VIDEO_PLAYBACK_URL_EXPIRATION_SECONDS`); client sees the storage host.

### Option B: API proxies bytes with Range support
- API reads `Range`, calls `GetObject` with `Range`, returns `206` + `Content-Range` and pipes the body.
- **Pros:** Storage host hidden; fine-grained per-request authorization.
- **Cons:** Every byte of every view flows through the API — the load the queue/storage design avoids. Contradicts the diagram.

### Option C: Adaptive streaming (HLS/DASH) transcoded by the worker
- **Pros:** Adaptive bitrate; best playback UX.
- **Cons:** Transcoding multiplies worker CPU time and storage; well beyond the phase's "streaming without full download" capability (progressive download over Range already satisfies it).

**Recommendation:** **Option A** — Redirecting to presigned URLs lets the object storage serve Range/`206` playback and attachment downloads directly, as the C4 diagram prescribes, with no API bandwidth; HLS is a future optimization rather than a phase 03 requirement.

**Decision:** A (302 redirect to short-lived presigned GET; storage serves Range/206)

**Libraries:** `@aws-sdk/s3-request-presigner@^3.x`

---

## TD-12: Video Status Lifecycle and Processing Failure Handling

**Scope:** Backend

**Capability:** Transversal — covers: Pré-cadastro automático do vídeo como rascunho ao iniciar o upload; Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** The video row is pre-registered as a draft when the upload starts and must reflect processing progress and failures in the database. Transient failures (storage/network hiccups) differ from permanent ones (corrupt or non-video file). Note: the Fase 04 "rascunho → publicação" flow is an editorial/visibility concern and will be modelled separately; this lifecycle is about the file. Depends on TD-01.

**Options:**

### Option A: `draft → processing → ready | failed` with bounded retries
- `draft` on upload initiation; `processing` when the API completes the multipart upload and enqueues the job; `ready` after metadata + thumbnail are persisted; `failed` after the final attempt (`attempts: 3`, exponential backoff starting at 5s) or immediately on `UnrecoverableError` (ffprobe finds no video stream / unreadable media). Failure reason stored in `processing_error`.
- **Pros:** Four states map exactly to the phase requirement; transient errors self-heal; permanent errors fail fast and are visible in the DB.
- **Cons:** No fine-grained "uploading %" state (progress is client-side).

### Option B: Add intermediate states (`uploading`, `uploaded`, `queued`)
- **Pros:** More granular observability.
- **Cons:** More transitions to keep consistent across API and worker for little user-visible value; `queued` duplicates BullMQ's own job state.

### Option C: Single attempt, no retries
- **Pros:** Simplest.
- **Cons:** A transient storage timeout permanently fails a valid video.

**Recommendation:** **Option A** — Four states cover the required lifecycle with each transition owned by one component (API: draft→processing; worker: processing→ready|failed), and BullMQ's attempts/backoff plus `UnrecoverableError` separate transient from permanent failures without custom code.

**Decision:** A (draft → processing → ready | failed, 3 attempts with exponential backoff)

**Libraries:** `bullmq@^6.x`

---

## TD-13: Processing Job Contract and Idempotency

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** The job message is the contract between the API (producer) and the worker (consumer) — cited in both and in the plan's Events/Messages spec. Jobs can be delivered more than once (retries, stalled job recovery, a client calling "complete" twice). Depends on TD-01 and TD-12.

**Options:**

### Option A: Minimal payload `{ videoId }`, deterministic `jobId = videoId`, worker re-reads state
- Queue `video-processing`, job name `process-video`. The worker loads the video from the DB, skips if not `processing`, and overwrites `thumbnail_key`/metadata deterministically.
- **Pros:** Single source of truth stays in the DB; duplicate enqueue is a no-op (BullMQ deduplicates by `jobId`); retries are safe because outputs are deterministic (same key, same fields).
- **Cons:** One extra DB read per job.

### Option B: Snapshot payload (storage key, MIME, size, owner)
- **Pros:** Worker needs fewer reads.
- **Cons:** Payload can drift from DB state; every schema change becomes a message versioning problem.

**Recommendation:** **Option A** — An ID-only message with a deterministic job ID makes enqueue and processing idempotent and keeps the database as the only source of truth.

**Decision:** A (payload `{ videoId }`, `jobId = videoId`, worker re-reads DB state)

**Libraries:** `bullmq@^6.x`

---

## TD-14: Testing Strategy for Storage, Queue and Worker

**Scope:** Backend

**Capability:** Transversal — covers: Serviço de armazenamento de arquivos (vídeos e thumbnails); Serviço de processamento em segundo plano (filas); Processamento automático do vídeo após upload (extração de duração e metadados); Reprodução via streaming (sem necessidade de download completo)

**Context:** The project's testing guide demands real infrastructure for integration/e2e tests (DB already real via Compose). Storage, queue and FFmpeg are new I/O boundaries. Test inputs need a real video file.

**Options:**

### Option A: Real Compose services + small committed fixture video + worker booted in-process in e2e
- Integration/e2e tests hit the real `minio` and `redis` services and real `ffprobe`/`ffmpeg` binaries; a few-KB generated MP4 fixture lives under `test/fixtures/`. The e2e suite boots the API app and the `WorkerModule` context in the same Jest process and polls the DB until the status transitions.
- **Pros:** Exercises the exact protocols (presigned multipart PUTs, Range/206, BullMQ delivery, FFmpeg parsing). Deterministic: the test owns the worker it waits on.
- **Cons:** Slower suites; tests depend on Compose services being up (already true for `db`).

### Option B: Mock S3 (`aws-sdk-client-mock`) and queue in integration tests
- **Pros:** Fast; no new services needed for tests.
- **Cons:** Does not validate presigned URL signing, multipart semantics, Range behaviour or FFmpeg output — the riskiest parts of the phase.

### Option C: Testcontainers per suite
- **Pros:** Fully isolated infra per run.
- **Cons:** Docker-in-Docker from inside the dev container; diverges from the established shared-Compose test pattern.

**Recommendation:** **Option A** — It follows the project's existing pattern (tests against Compose services) and covers the protocols that mocks cannot validate; unit tests still mock collaborators per the testing rules.

**Decision:** A (real Compose services + committed fixture + in-process worker in e2e)

---

## TD-15: Abandoned Multipart Upload Cleanup

**Scope:** Backend

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** With TD-02 the client drives a multipart upload that can be abandoned at any part. Incomplete multipart uploads keep their parts in storage (billed on AWS S3) until aborted, and `docs/project-plan.md` § Pontos de Atenção asks to plan storage growth and cost from the start. Resumability (TD-02) requires keeping parts for a reasonable window. Added after `plan-validate` raised `MD-1`. Verified on 2026-10-16 against the MinIO image of TD-05: `mc admin config get <alias> api` reports `stale_uploads_expiry=24h` and `stale_uploads_cleanup_interval=6h` by default. Depends on TD-02 and TD-04.

**Options:**

### Option A: Storage-level expiry of incomplete uploads (no app code)
- MinIO aborts incomplete multipart uploads older than `MINIO_API_STALE_UPLOADS_EXPIRY` (set explicitly to `24h` in Compose); in AWS S3 the equivalent is a bucket lifecycle rule `AbortIncompleteMultipartUpload` (`DaysAfterInitiation: 1`). The video row stays `draft`; a resume attempt after expiry gets a domain error (upload no longer exists) and the client must start a new upload.
- **Pros:** Zero application code or scheduler; storage reclaims parts on its own; 24h comfortably covers resuming a 10GB upload.
- **Cons:** Abandoned `draft` rows remain in the DB (cleanup of the row is left to the Fase 04 management panel); policy lives in infra config per environment.

### Option B: Scheduled cleanup job in the worker (BullMQ repeatable job)
- A repeatable job finds `draft` videos older than N hours, calls `AbortMultipartUpload` and deletes/marks the rows.
- **Pros:** Cleans storage and DB consistently; policy in code and testable.
- **Cons:** New scheduled job, more code and tests for a concern the storage already solves; race with clients resuming near the cutoff.

### Option C: Explicit client abort endpoint only (`DELETE /videos/:slug/upload`)
- **Pros:** Immediate cleanup when the user cancels.
- **Cons:** Does not cover the main case (crashed tab, lost connection) — still needs A or B underneath.

**Recommendation:** **Option A** — The storage already expires stale multipart uploads (MinIO default verified, AWS via lifecycle rule), so pinning the 24h window in Compose covers cost control and resumability without new code; leftover `draft` rows cost no storage and are naturally managed by the Fase 04 panel.

**Decision:** A (storage-level expiry of incomplete uploads, 24h)

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Message Queue Technology | A (BullMQ + Redis) | A |
| TD-02 | Cross-layer | Large File Upload Strategy | A (S3 Multipart with presigned part URLs) | A |
| TD-03 | Cross-layer | Upload Limits and Part Sizing Policy | A (fixed 100 MiB parts, 10 GiB max, MIME allowlist) | A |
| TD-04 | Backend | Object Storage Layout, Provisioning and Presigned Endpoint | A (single private bucket, per-video prefix, init container, dual endpoint) | A |
| TD-05 | Repo-wide | Object Storage Container Image | A (Chainguard MinIO pinned by digest) | A |
| TD-06 | Backend | Video Worker Runtime and Deployment | A (same codebase, separate entrypoint + Compose service) | A |
| TD-07 | Backend | FFmpeg Integration Approach | A (spawn ffprobe/ffmpeg directly) | A |
| TD-08 | Backend | Worker Media Access Strategy | A (presigned GET URL as FFmpeg input) | A |
| TD-09 | Backend | Thumbnail Generation Policy | A (frame at 10% of duration, JPEG ≤1280px) | A |
| TD-10 | Backend | Unique Video URL Identifier | B (11-char base64url slug + unique index) | B |
| TD-11 | Cross-layer | Streaming and Download Delivery | A (302 to presigned GET; storage serves Range/206) | A |
| TD-12 | Backend | Video Status Lifecycle and Failure Handling | A (draft → processing → ready/failed, 3 attempts) | A |
| TD-13 | Backend | Processing Job Contract and Idempotency | A (`{ videoId }`, `jobId = videoId`) | A |
| TD-14 | Backend | Testing Strategy for Storage, Queue and Worker | A (real Compose services + fixture + in-process worker) | A |
| TD-15 | Backend | Abandoned Multipart Upload Cleanup | A (storage-level expiry, 24h) | A |
