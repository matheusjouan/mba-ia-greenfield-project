---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-10-16T13:43:58-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-16T22:00:13-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-10-16T13:43:58-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-10-16T13:43:58-03:00"
  docs/phases/phase-02-auth/context.md: "2026-10-16T13:43:58-03:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-10-16T13:43:58-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-10-16T13:43:58-03:00"
---

# phase-03-videos — Context

## Scope

**Phase name:** Fase 03 — Upload e Processamento de Vídeos

**Capabilities** (literal, `docs/project-plan.md`):

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** _Not specified in project-plan.md._ Boundary by neighbors: edição de informações do vídeo, categorias, visibilidade público/unlisted, fluxo rascunho → publicação editorial, thumbnail customizada e painel do canal (Fase 04); player, página de visualização e contagem de visualizações (Fase 05).

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:** `nestjs-project/` _(no subproject path named in the phase text; derived from the phase-scope decisions doc `_Subprojects in scope:_`)_

**Deferred subprojects:** `next-frontend/` — the phase has no UI capability bullet; the upload/watch screens belong to later phases.

**Sequencing notes:** Depende de: Fase 01, Fase 02.

**Neighbors (for boundary detection only):**

- **Phase 02:** Fase 02 — Cadastro, Login e Gerenciamento de Conta (depende de: Fase 01)
- **Phase 04:** Fase 04 — Gerenciamento de Vídeos e Canal (depende de: Fase 02, Fase 03)

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | phase | Backend | Message Queue Technology | decided | A (BullMQ + Redis) | `bullmq@^6.x`, `@nestjs/bullmq@^11.x`, `ioredis@^5.x` |
|   └─ Last revision: 2026-10-16 — `@nestjs/bullmq` ^12 → ^11 (12 is ESM-only), `ioredis@^5` added (optional peer of bullmq 6) | | | | | | |
| phase-03-videos/TD-02 | phase | Cross-layer | Large File Upload Strategy (up to 10GB) | decided | A (S3 Multipart Upload with presigned part URLs) | `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x` |
| phase-03-videos/TD-03 | phase | Cross-layer | Upload Limits and Part Sizing Policy | decided | A (fixed env-configurable 100 MiB parts, 10 GiB max, MIME allowlist) | — |
| phase-03-videos/TD-04 | phase | Backend | Object Storage Layout, Provisioning and Presigned Endpoint | decided | A (single private bucket, per-video prefix, minio-init container, dual endpoint) | `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x` |
| phase-03-videos/TD-05 | phase | Repo-wide | Object Storage Container Image | decided | A (Chainguard MinIO images pinned by digest) | — |
| phase-03-videos/TD-06 | phase | Backend | Video Worker Runtime and Deployment | decided | A (same NestJS codebase, separate entrypoint and Compose service) | `bullmq@^6.x`, `@nestjs/bullmq@^11.x` |
| phase-03-videos/TD-07 | phase | Backend | FFmpeg Integration Approach | decided | A (spawn ffprobe/ffmpeg directly via node:child_process) | — |
| phase-03-videos/TD-08 | phase | Backend | Worker Media Access Strategy | decided | A (presigned GET URL as FFmpeg input) | `@aws-sdk/s3-request-presigner@^3.x` |
| phase-03-videos/TD-09 | phase | Backend | Thumbnail Generation Policy | decided | A (frame at 10% of duration, JPEG, max 1280px wide) | — |
| phase-03-videos/TD-10 | phase | Backend | Unique Video URL Identifier | decided | B (11-char base64url slug via node:crypto + unique index + retry) | — |
| phase-03-videos/TD-11 | phase | Cross-layer | Streaming and Download Delivery | decided | A (302 redirect to short-lived presigned GET; storage serves Range/206) | `@aws-sdk/s3-request-presigner@^3.x` |
| phase-03-videos/TD-12 | phase | Backend | Video Status Lifecycle and Processing Failure Handling | decided | A (draft → processing → ready \| failed, 3 attempts with exponential backoff) | `bullmq@^6.x` |
| phase-03-videos/TD-13 | phase | Backend | Processing Job Contract and Idempotency | decided | A (payload `{ videoId }`, `jobId = videoId`, worker re-reads DB state) | `bullmq@^6.x` |
| phase-03-videos/TD-14 | phase | Backend | Testing Strategy for Storage, Queue and Worker | decided | A (real Compose services + committed fixture + in-process worker in e2e) | — |
| phase-03-videos/TD-15 | phase | Backend | Abandoned Multipart Upload Cleanup | decided | A (storage-level expiry of incomplete uploads, 24h) | — |

_Source files:_

- phase-03-videos — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase, related_phases: [3])

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-04, phase-03-videos/TD-05, phase-03-videos/TD-14 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01, phase-03-videos/TD-06, phase-03-videos/TD-14 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02, phase-03-videos/TD-03, phase-03-videos/TD-15 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-12 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-06, phase-03-videos/TD-07, phase-03-videos/TD-08, phase-03-videos/TD-12, phase-03-videos/TD-13, phase-03-videos/TD-14 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-07, phase-03-videos/TD-08, phase-03-videos/TD-09 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-10 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-11, phase-03-videos/TD-14 |
| Download do vídeo pelo usuário | phase-03-videos/TD-11 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** It is the only option with an official NestJS 11–compatible module that delivers retries/backoff/deduplication out of the box (needed by TD-11 and TD-12), while keeping the queue as a separate container exactly as the C4 diagram prescribes; pg-boss would save one container but merge the queue into the database, and RabbitMQ requires hand-built retry topology for no benefit at the current single-consumer scale.
**Libraries:** `bullmq@^6.x`, `@nestjs/bullmq@^11.x`, `ioredis@^5.x`

**Revisions:**
- 2026-10-16 — `@nestjs/bullmq` pinned to `^11.x` (was `^12.x`, ESM-only) and `ioredis@^5.x` added (optional peer of `bullmq@6`, restricted to `^5` by `typeorm@0.3.28`). Found while implementing SI-03.6.

### phase-03-videos/TD-02

**Recommendation:** It is the only option where the 10GB payload bypasses the API entirely while satisfying resumability through `ListParts`; it uses the S3 API that both MinIO (dev) and AWS S3 (prod) implement, so no extra server component is introduced. The frontend cost (part orchestration) is deferred to the phase that builds the upload UI.
**Libraries:** `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x`

### phase-03-videos/TD-03

**Recommendation:** A fixed 100 MiB default keeps a 10GB upload at ~103 parts (cheap to sign and to list on resume) while remaining configurable per environment; the MIME allowlist plus post-completion `HeadObject` size check enforces the 10 GiB ceiling server-side even though bytes bypass the API.
**Libraries:** —

### phase-03-videos/TD-04

**Recommendation:** A single private bucket with a per-video prefix keeps every artifact behind presigned URLs (compatible with Fase 04 unlisted visibility), keeps provisioning in infrastructure where prod will also put it, and the dual endpoint isolates the one place where the client-facing host differs from the Compose service name.
**Libraries:** `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x`

### phase-03-videos/TD-05

**Recommendation:** It keeps MinIO as the diagram prescribes with an image that pulls today and carries current fixes; pinning by digest addresses the `latest`-only limitation, and since the app only speaks the S3 API, swapping the image later costs one Compose line.
**Libraries:** —

### phase-03-videos/TD-06

**Recommendation:** A second entrypoint over the same codebase delivers the diagram's isolated worker container while reusing the `Video` entity, config and storage module; Option B reintroduces the API blocking the phase is meant to avoid, and Option C buys image size at the cost of duplication the project does not need yet.
**Libraries:** `bullmq@^6.x`, `@nestjs/bullmq@^11.x`

### phase-03-videos/TD-07

**Recommendation:** Direct spawning of the official binaries with ffprobe's JSON output gives a stable, dependency-free contract; the only maintained-looking wrapper is deprecated and wasm cannot handle 10GB inputs.
**Libraries:** —

### phase-03-videos/TD-08

**Recommendation:** Presigned HTTP input lets FFmpeg's own range-aware demuxers read only what they need, keeping the worker's disk usage constant regardless of file size; full download wastes up to 10GB per job and stdin piping breaks on non-faststart files.
**Libraries:** `@aws-sdk/s3-request-presigner@^3.x`

### phase-03-videos/TD-09

**Recommendation:** 10% of duration avoids black intros at the same cost as a fixed offset, and the scale cap keeps thumbnails light for listing pages in later phases.
**Libraries:** —

### phase-03-videos/TD-10

**Recommendation:** An 11-char base64url slug from `node:crypto` is short and unguessable (required for future unlisted links) while the database unique index makes "never conflicts" a guarantee rather than a probability; Sqids is enumerable and nanoid is ESM-only.
**Libraries:** —

### phase-03-videos/TD-11

**Recommendation:** Redirecting to presigned URLs lets the object storage serve Range/`206` playback and attachment downloads directly, as the C4 diagram prescribes, with no API bandwidth; HLS is a future optimization rather than a phase 03 requirement.
**Libraries:** `@aws-sdk/s3-request-presigner@^3.x`

### phase-03-videos/TD-12

**Recommendation:** Four states cover the required lifecycle with each transition owned by one component (API: draft→processing; worker: processing→ready|failed), and BullMQ's attempts/backoff plus `UnrecoverableError` separate transient from permanent failures without custom code.
**Libraries:** `bullmq@^6.x`

### phase-03-videos/TD-13

**Recommendation:** An ID-only message with a deterministic job ID makes enqueue and processing idempotent and keeps the database as the only source of truth.
**Libraries:** `bullmq@^6.x`

### phase-03-videos/TD-14

**Recommendation:** It follows the project's existing pattern (tests against Compose services) and covers the protocols that mocks cannot validate; unit tests still mock collaborators per the testing rules.
**Libraries:** —

### phase-03-videos/TD-15

**Recommendation:** The storage already expires stale multipart uploads (MinIO default verified, AWS via lifecycle rule), so pinning the 24h window in Compose covers cost control and resumability without new code; leftover `draft` rows cost no storage and are naturally managed by the Fase 04 panel.
**Libraries:** —

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** Option A (@nestjs/config) — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.

**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Option A (Joi) — First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request. Zod is elegant but adds a third validation paradigm to the project.

**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Option B (Namespaced/grouped with registerAs) — The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`. Initial files for Phase 01: `src/config/database.config.ts`, `src/config/app.config.ts`.

**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Option A (Shared registerAs factory) — Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.

**Libraries:** `dotenv` (transitive via `@nestjs/config`)

### phase-02-auth/TD-01

**Recommendation:** Argon2id — For a greenfield project in 2026, Argon2id is the OWASP-recommended choice. The native build dependency is a one-time Docker setup cost. The project has no legacy constraints favoring bcrypt. OWASP minimum: 19MiB memory, 2 iterations.

**Libraries:** `argon2@^0.41.x`

### phase-02-auth/TD-02

**Recommendation:** Option A (@nestjs/passport) — The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login. Aligns with official NestJS docs, making onboarding and maintenance easier.

**Note:** Decision deliberately diverged from the Recommendation during implementation — custom guards were preferred over `@nestjs/passport` to keep the dependency surface smaller; social login is not on the near-term roadmap, so the plugin-architecture benefit did not justify the extra abstraction layer.

**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-03

**Recommendation:** Option A (Refresh Token Rotation) — Provides the strongest security model with automatic theft detection. The DB write overhead is acceptable for a video platform (auth refresh is infrequent vs. video operations). PostgreSQL is already in the stack, so no new infrastructure needed. Race conditions can be mitigated with a short grace period for the old token.

**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Option B (Random Opaque Tokens in DB) — Revocability is important: when a user requests a new password reset, previous tokens should be invalidated. The DB table is trivial to implement, and the tokens table can also serve future needs (e.g., API keys). Keeps email tokens decoupled from the JWT auth system.

**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** Option A (@nestjs-modules/mailer) — Best NestJS integration with minimal boilerplate. Supports SMTP (matching the architecture diagram), works with MailHog/Mailpit for local development without external dependencies, and scales to any SMTP provider in production. Template engine support (Handlebars) simplifies email formatting. No vendor lock-in.

**Libraries:** `@nestjs-modules/mailer@^2.x`, `handlebars@^4.x`

### phase-02-auth/TD-06

**Recommendation:** Option A (class-validator + class-transformer) — This is a backend-only project (no shared schemas with frontend), so Zod's single-source-of-truth advantage is less impactful. class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.

**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Option A (Custom Domain Exception Filter) — Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. The project is single-consumer (first-party frontend), so a simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity. The custom filter cost is low — two small files.

**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** Option A (@nestjs/throttler) — Native NestJS integration is decisive: the guard system allows scoping rate limiting to `AuthModule` only via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. The project is single-instance with no distributed requirements, so in-memory storage is sufficient. Using express-rate-limit would bypass NestJS's DI and guard lifecycle for no clear benefit.

**Libraries:** `@nestjs/throttler@^6.x`

### phase-02-auth/TD-09

**Recommendation:** Option B (Opaque) — Since DB lookup is mandatory (TD-03), JWT signature adds no security value. Opaque tokens are shorter, leak no data, and are simpler to generate.

**Note:** Decision deliberately diverged from the Recommendation — JWT was kept to reuse the access-token signing/verification infrastructure (`@nestjs/jwt`), trading token size and base64-readability for a single token format across the codebase.

**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-10

**Recommendation:** Option A — The platform is a video sharing service with URL-based channel handles. A strict `[a-z0-9_]` allowlist is the simplest and most portable choice: no extra dependencies, no edge cases around hyphen positioning, and the `user_<random>` fallback provides a valid handle even for extreme email prefixes. Hyphens can always be added in a future iteration if user feedback justifies it.

**Libraries:** —

### phase-02-auth-frontend/TD-01

**Recommendation:** Three reasons. (1) **Architectural fit.** The strict-BFF model in `next-frontend-config-base/TD-03` already nominates the Route Handler as the only NestJS caller; cookie-based sessions are the natural match, and Auth.js's framework adds layers between the BFF and the cookie that buy nothing because the backend is the auth authority. (2) **Smaller blast radius.** A ~50-LOC session helper is grep-friendly, debuggable, and test-friendly via the existing MSW+BFF integration test pattern. (3) **Compatibility with Next.js 16 / React 19.** Built-in `next/headers` `cookies()` is the canonical primitive both runtimes already use. Option C is rejected as unsafe (`localStorage` for refresh tokens) and architecturally regressive.

**Libraries:** —

### phase-02-auth-frontend/TD-02

**Recommendation:** Three reasons. (1) **Defense in depth on the cookie content** — `httpOnly` blocks JS, encryption blocks accidental log/proxy inspection. (2) **Single cookie to manage** simplifies logout. (3) **Room to carry minimal user metadata** (`userId`, `email`, `channelSlug`) lets `app/layout.tsx` RSC render the authenticated chrome without a per-render `/auth/me` round-trip. Option C is rejected: it solves a problem (server-side revocation) the project does not have.

**Libraries:** iron-session

### phase-02-auth-frontend/TD-03

**Recommendation:** The single-flight detail is non-trivial and goes in the helper from day one — tested by MSW with a "two concurrent intercepted upstream calls; one refresh expected" assertion. Option B's client-driven pattern is rejected because it doesn't replace Option A (RSC still needs server-side refresh). Option C's pre-emptive timer is rejected because the failure modes (multiple tabs, sleep/wake) outweigh the latency saving.

**Libraries:** —

### phase-02-auth-frontend/TD-04

**Recommendation:** Three reasons. (1) **Decoupled from TD-05** — works with Route Handlers OR Server Actions. (2) **Aligned with shadcn's canonical form primitive** (react-hook-form wrappers). (3) **Zod-first developer ergonomics match the rest of the FE foundation.** Option B is rejected for impedance with shadcn's primitive; Option C for per-field boilerplate.

**Libraries:** react-hook-form, @hookform/resolvers

### phase-02-auth-frontend/TD-05

**Recommendation:** Three reasons. (1) **Strict-BFF alignment** — Route Handlers are the BFF surface; every mutation visible under `app/api/**`. (2) **Test scaffold already exists** for Route-Handlers-as-functions. (3) **Single mutation surface** — Phase 02 sets the precedent for Phases 03–07.

**Libraries:** —

### phase-02-auth-frontend/TD-06

**Recommendation:** Two reinforcing reasons. (1) **No first-render flicker, no round-trip** — the session is delivered in the same response as the page HTML. (2) **No new BFF endpoint** — the cookie is the source of truth, RSC reads it, the Provider broadcasts it.

**Libraries:** —

### phase-02-auth-frontend/TD-07

**Recommendation:** Three reasons. (1) **First-paint-correct**. (2) **Single integration pattern across both flows** — "RSC owns the token, Client Component owns the input". (3) **Email-prefetch behavior** is solved at the backend's idempotent-confirmation level.

**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** `@nestjs/swagger` — é a única opção que preserva as decisões anteriores (`class-validator` em TD-06 de phase-02-auth) sem re-platform; o CLI plugin com `classValidatorShim: true` aproveita os decoradores `class-validator` existentes para inferir schemas, mantendo o boilerplate baixo.

**Libraries:** @nestjs/swagger

### openapi-docs-nestjs/TD-02

**Recommendation:** Ambos (runtime UI + `openapi.json` exportado) — o custo marginal é apenas um npm script e o benefício é uma fundação correta para futura integração FE (codegen offline) sem perder a UI interativa que dev/QA usam.

**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** Apenas em dev/staging via env flag — alinha com a postura defensiva já estabelecida em phase 02; o `openapi.json` commitado em TD-02 cumpre o papel de "spec consultável fora da UI".

**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, validationOptions: { allowUnknown: true, abortEarly: false } })`. _(from phase 01)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function for non-DI contexts. _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` and calls it as a plain function. _(from phase 01)_
- Database connection parameters are sourced from a single `databaseConfig` factory — never duplicated between `AppModule` and `data-source.ts`. _(from phase 01)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `inject: [databaseConfig.KEY]`, `useFactory` returning options including `autoLoadEntities: true`, `synchronize: false`. _(from phase 01)_

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| "Confirmação de conta via e-mail com link de ativação" | deferred | phase-02-auth-frontend | deferred_to_next_phase — UI landing screen de-scoped 2026-05-14; FE confirmation flow (TD-07) picked up by a future phase. BE side unchanged in `phase-02-auth`. |
| "Logout" | deferred | phase-02-auth-frontend | deferred_to_next_phase — logout button lives inside authenticated chrome (typically Phase 04). |
| "Recuperação de senha (destination screen / set-new-password)" | deferred | phase-02-auth-frontend | deferred_to_next_phase — reset-password destination screen absent from Figma; documented as a known gap. |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha" | deferred | phase-02-auth-frontend | umbrella bullet deferred to the phase that lands the missing confirmação and reset-password screens. |

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

### nestjs-project

_(from `testing-guide-nestjs-project` § 3 Feature Implementation Checklist)_

| Artifact type | Required layers |
|---------------|-----------------|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false` |
| Service with branching + DB | Unit: branch logic (mock repo) + Integration: DB contract |
| Service with DB only (no branching) | Integration: DB contract |
| Service with configured lib (JWT, cache) | Unit: real lib with test config |
| Service with side-effect dep (email, storage) | Integration: real capture service (Mailpit) or local adapter |
| Module with configured imports | Unit: compilation test |
| Controller | E2E only — do NOT write unit tests |
| DTO | E2E: one validation wiring test per endpoint |
| Guard (delegates to service for business logic) | E2E + Unit if complex internal logic |
| Exception Filter | Unit + E2E |
| Queue consumer / processor (`artifacts/future-types.md`) | Unit (mock deps) when it has business logic + Integration (real DB/storage) |

_External systems (`references/external-systems.md`):_ PostgreSQL real (Docker `db`); Message Queue real (Docker broker, technology TBD at guide authoring time — BullMQ/Redis example given); Email via Mailpit; Object Storage via **local filesystem adapter** in development and tests ("S3 in production").

### next-frontend

_Deferred subproject — no frontend work in this phase._
