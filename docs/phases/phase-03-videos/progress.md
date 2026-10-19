# phase-03-videos — Progress

**Status:** completed
**SIs:** 17/17 completed

## Final verification (Definition of Done)

| Check | Command (inside `nestjs-project`) | Result |
|-------|-----------------------------------|--------|
| Unit + integration | `docker compose exec nestjs-api npm test` | 248/248 passing, 39 suites, exit 0 |
| E2E | `docker compose exec nestjs-api npm run test:e2e` | 80/80 passing, 9 suites, exit 0 |
| Type-check | `docker compose exec nestjs-api npx tsc --noEmit` | exit 0 |
| Lint | `docker compose exec nestjs-api npm run lint` | exit 0 (0 errors, 45 warnings from rules configured as `warn`) |
| Build | `npm run build` / `npm run build:worker` | `dist/main.js` and `dist-worker/worker.js` produced |
| Infra | `docker compose up -d` | `db`, `mailpit`, `minio` (healthy), `minio-init` (exit 0), `redis` (healthy), `video-worker` (consuming), `nestjs-api` |

Fixes applied during final verification:
- `npm test` and `npm run test:e2e` ran suites in parallel against the shared database/queue (the `--runInBand` the backend `CLAUDE.md` described as "already configured" was not in the scripts): `"maxWorkers": 1` added to both Jest configs, so the plain commands are serialized.
- `migrations.integration-spec.ts` dropped related tables with concurrent `DROP ... CASCADE` (`Promise.all`), which failed intermittently (1 of 5 full runs) once `videos` extended the FK chain; drops are now sequential.

Follow-ups (out of scope, not acted on):
- ~~`npm run openapi:export` (ts-node) does not apply the `@nestjs/swagger` CLI plugin, so request DTO schemas are exported without properties~~ — resolved in `bugfix/openapi-export-request-schemas` (export now runs from the compiled build).
- `ALL_ENTITIES` is duplicated across ~12 test files; a shared helper would avoid touching all of them when an entity is added.
- `ChannelsService` keeps its own unique-violation check; it could reuse `src/common/database/pg-errors.ts`.
- The `context7` MCP server was missing from this fork's `.mcp.json` during the phase (Context7 was consulted over its HTTP API); added afterwards in `bugfix/mcp-context7`.

### SI-03.1 — Instalar dependências e namespaces de configuração da fase
- **Status:** completed
- **Tests:** 11/11 passing (env.validation.integration-spec.ts); `test/app.e2e-spec.ts` 1/1; `tsc --noEmit` exit 0
- **Observations:**
  - `forcePathStyle` confirmado em `@aws-sdk/client-s3` `dist-types/endpoint/EndpointParameters.d.ts` (`ClientInputEndpointParameters`) — fecha a pendência registrada em `library-refs.md`.
  - `S3_ACCESS_KEY`/`S3_SECRET_KEY` passaram a ser obrigatórios: `requiredEnv` do teste de schema foi estendido para manter os casos existentes verdes.

### SI-03.2 — Infra: subir MinIO, Redis e FFmpeg no Docker Compose
- **Status:** completed
- **Tests:** no tests (Infra) — ACs verificados manualmente: `minio`/`redis` healthy, `minio-init` exit 0 (idempotente em novo `up`), bucket `streamtube` listado via `mc ls`, `ffprobe`/`ffmpeg` 5.1.9 no `nestjs-api`, `maxmemory-policy noeviction`, MinIO `stale_uploads_expiry=24h`
- **Observations:**
  - A imagem Chainguard do MinIO roda como não-root e já traz `mc`; o healthcheck usa `mc ready` contra o próprio container. A imagem `minio-client` não tem shell, por isso `minio-init` usa `MC_HOST_local` em vez de `mc alias set`.
  - No Git Bash do Windows, comandos `docker run` com caminhos absolutos (`/data`) precisam de `MSYS_NO_PATHCONV=1` (conversão automática de caminho).

### SI-03.3 — Criar StorageModule para multipart, URLs pré-assinadas e objetos
- **Status:** completed
- **Tests:** 10/10 passing (storage.service.integration-spec.ts: 9 contra MinIO real, storage.module.spec.ts: 1)
- **Observations:**
  - Os clientes S3 usam `requestChecksumCalculation`/`responseChecksumValidation: 'WHEN_REQUIRED'`: no default o SDK `3.1152` embute `x-amz-checksum-crc32=AAAAAA==` (checksum de corpo vazio) nas URLs pré-assinadas de `UploadPart`, o que invalidaria o `PUT` do cliente — verificado comparando as URLs geradas nos dois modos.
  - O lint do baseline (Fase 02) já falha com 162 erros em 11 arquivos pré-existentes — fora do escopo deste SI; registrado como bugfix separado (necessário para a DoD). O helper do `env.validation.integration-spec.ts` (estendido no SI-03.1) foi tipado para não vazar `any`.

### SI-03.4 — Criar entidade Video, VideosModule e migration CreateVideos
- **Status:** completed
- **Tests:** 10/10 passing (video.entity.integration-spec.ts: 7, migrations.integration-spec.ts: 2, videos.module.spec.ts: 1); suíte unit+integração completa 169/169
- **Observations:**
  - Migration `1792197432141-CreateVideos` gerada pela CLI e revisada (enum `videos_status_enum`, `UNIQUE(slug)`, índice e FK `channel_id` com `ON DELETE CASCADE`).
  - Como `Channel` passou a ter o lado inverso `videos`, os 10 testes da Fase 02 que montam `DataSource` com `Channel` precisaram incluir `Video` em `ALL_ENTITIES` (sem isso o TypeORM falha ao construir os metadados da relação). A lista de entidades duplicada em cada teste é candidata a um helper compartilhado — fora do escopo.
  - O `id` é atribuído pelo serviço antes do insert (a `storage_key` o embute); o teste confirma que o TypeORM persiste o id fornecido mesmo com `@PrimaryGeneratedColumn('uuid')`.

### SI-03.5 — Pré-cadastrar vídeo como rascunho ao iniciar o upload
- **Status:** completed
- **Tests:** 22/22 passing (video-slug.util.spec.ts: 2, videos.service.spec.ts: 8, videos.service.integration-spec.ts: 5, channels.service.integration-spec.ts: 7 incl. 2 novos de `findByUserId`); `videos.module.integration-spec.ts` 1/1
- **Observations:**
  - O teste de compilação do `VideosModule` sobe `TypeOrmModule.forRoot` contra o banco, então foi nomeado `videos.module.integration-spec.ts` (regra de sufixo do `nestjs-project/CLAUDE.md`) em vez do `videos.module.spec.ts` listado no SI-03.4.
  - Criado `src/common/database/pg-errors.ts` (`isUniqueViolationOn`) para o retry de slug. `ChannelsService` mantém sua cópia local da mesma checagem — unificar é refactor fora do escopo.
  - `findByUserId` usa `dataSource.getRepository(Channel)` para não alterar o construtor de `ChannelsService` (usado diretamente pelos testes da Fase 02).

### SI-03.6 — Configurar a fila video-processing e o produtor de jobs
- **Status:** completed
- **Tests:** 6/6 passing (video-processing.producer.integration-spec.ts: 5 contra Redis real, queues.module.integration-spec.ts: 1); `test/app.e2e-spec.ts` 1/1 com o `BullModule` raiz no `AppModule`
- **Observations:**
  - **Revisão de biblioteca (TD-01 Revisions):** `@nestjs/bullmq@12.0.0` é ESM-only (`"type": "module"`) e não carrega no Jest CommonJS — fixado em `^11.0.5` (CommonJS, peer NestJS 10/11). `bullmq@6` declara `ioredis` como peer **opcional** (o `library-refs.md` dizia "transitivo"); instalado `ioredis@^5.11.1` porque `typeorm@0.3.28` restringe esse peer opcional a `^5`. Decisions doc, `context.md` e `library-refs.md` atualizados; o texto do SI-03.1 no plano (já executado) ainda cita `^12.0.0`.
  - O setup de teste (`src/test/jest-setup-env.ts`) roda **antes** do `dotenv/config` nas duas configs do Jest: o `dotenv` não sobrescreve variáveis já definidas, então os testes usam o prefixo `streamtube-test` mesmo com `QUEUE_PREFIX=bull` no `.env`. No `jest-e2e.json` o caminho é relativo a `test/` (`<rootDir>/../src/...`).
  - O teste de compilação abre conexão Redis, então foi nomeado `queues.module.integration-spec.ts` (regra de sufixo) em vez de `queues.module.spec.ts`.
  - A factory `bullRootOptions` (`src/queues/bull-root.options.ts`) foi criada já neste SI para ser reaproveitada pelos testes e, no SI-03.13, pelo `WorkerModule`.

### SI-03.7 — Retomar e concluir o upload, disparando o processamento
- **Status:** completed
- **Tests:** 29/29 passing (videos.service.spec.ts: 17 unit, videos.service.integration-spec.ts: 12 contra DB + MinIO + Redis reais); `videos.module.integration-spec.ts` 1/1; `test/app.e2e-spec.ts` 1/1
- **Observations:**
  - A integração usa partes de 5 MiB via `overrideProvider(videoConfig.KEY)` (o mínimo do S3) para cenários de múltiplas partes sem enviar 100 MiB; não altera `process.env`, que vazaria entre arquivos no `--runInBand`.
  - `upload_id` é zerado logo após o `CompleteMultipartUpload` (o upload deixa de existir no storage), inclusive no caminho de tamanho divergente.

### SI-03.8 — Endpoint POST /videos
- **Status:** completed
- **Tests:** 6/6 passing (test/videos-create.e2e-spec.ts, gerado da spec `specs/videos-create.plan.md`)
- **Observations:**
  - Criado `test/helpers/videos-e2e.ts` (bootstrap do `AppModule` com pipe/filtros de `main.ts`, reset de tabelas + throttler, login real via endpoints de auth e PUT direto no storage), reaproveitado pelos specs de vídeo seguintes.
  - O mapeamento entidade → resposta snake_case fica em métodos estáticos `from()` dos DTOs de resposta, mantendo o controller fino.

### SI-03.9 — Endpoint GET /videos/:slug/upload
- **Status:** completed
- **Tests:** 5/5 passing (test/videos-upload-status.e2e-spec.ts, gerado da spec `specs/videos-upload-status.plan.md`)
- **Observations:**
  - O cenário 1.2 da spec chega a `processing` chamando `POST /videos/:slug/upload/complete`, endpoint que só existe no SI-03.10 (dependência não capturada no Dependency Map). Para não implementar fora de ordem, o teste usa `VideosService.completeUpload` — a mesma operação de domínio que o endpoint encapsula.
  - `createVideosE2eApp` passou a aceitar overrides da config de vídeo (`overrideProvider(videoConfig.KEY)`), usado aqui para partes de 5 MiB.

### SI-03.10 — Endpoint POST /videos/:slug/upload/complete
- **Status:** completed
- **Tests:** 5/5 passing (test/videos-upload-complete.e2e-spec.ts, gerado da spec `specs/videos-upload-complete.plan.md`; inclui verificação do job `process-video` na fila Redis sob o prefixo de teste)
- **Observations:** none

### SI-03.11 — Extrair metadados e thumbnail com ffprobe/ffmpeg
- **Status:** completed
- **Tests:** 11/11 passing (media-probe.parser.spec.ts: 6 unit, media-probe.service.integration-spec.ts: 5 com ffprobe/ffmpeg reais sobre arquivo local e URL pré-assinada do MinIO)
- **Observations:**
  - Fixture `test/fixtures/sample.mp4` (23 KB: 3 s, 320x240, H.264 + AAC, 15 fps, `+faststart`) gerado com o FFmpeg do container.
  - Falhas do FFmpeg são classificadas: mídia ilegível → `InvalidMediaError` (permanente, vira `UnrecoverableError` no SI-03.12); conexão recusada / timeout / 5xx do storage → `Error` comum, para o BullMQ re-tentar. Coberto por teste contra uma porta inexistente.

### SI-03.12 — Processar o vídeo no worker e fechar o ciclo de status
- **Status:** completed
- **Tests:** 16/16 passing (video-processing.service.spec.ts: 7 unit, video-processing.processor.spec.ts: 5 unit, video-processing.service.integration-spec.ts: 3 com DB + MinIO + FFmpeg reais, video-worker.module.integration-spec.ts: 1); suíte `src/videos` re-executada 39/39
- **Observations:**
  - `markReady`/`markFailed` só atualizam linhas em `processing` (`UPDATE ... WHERE id AND status = 'processing'`), o que torna as transições do worker idempotentes e impede sobrescrever um vídeo já `ready`.
  - Layout de chaves do storage centralizado em `src/videos/video-storage-keys.ts` (usado pela API e pelo worker).
  - Os testes de compilação/integração que sobem o `BullModule`/Postgres usam o sufixo `*.integration-spec.ts` (`video-worker.module.integration-spec.ts` em vez do `video-worker.module.spec.ts` do plano). A entrega do job pela fila real (evento `failed` → `markFailed`) é exercitada no SI-03.13 e nos e2e.

### SI-03.13 — Subir o worker de vídeo como processo e serviço Compose próprios
- **Status:** completed
- **Tests:** 3/3 passing (worker.module.integration-spec.ts: contexto sem HTTP, worker registrado na fila, vídeo com mídia ilegível → `failed` pela fila BullMQ real); e2e `app` + `videos-create` 7/7 após a extração das opções raiz. Smoke manual: upload concluído via `VideosService` no container da API (prefixo `bull`) processado pelo container `video-worker` até `ready` (3 s, 320x240, thumbnail gravado); `getWorkers()` na fila `bull` = 1.
- **Observations:**
  - Achado: com `autoLoadEntities`, o worker só conhecia `Video` e `Channel` e falhava ao montar a relação `Channel.user` — o `WorkerModule` importa `UsersModule`. Os testes com listas explícitas de entidades não pegavam isso; o `worker.module.integration-spec.ts` (que usa as opções raiz reais) cobre.
  - Opções raiz extraídas para `src/config/config-module.options.ts`, `src/database/typeorm.options.ts` e `src/queues/bull-root.options.ts`, compartilhadas por `AppModule` e `WorkerModule` (um único `databaseConfig`).
  - Saída de build do worker isolada em `dist-worker/` (`tsconfig.worker.json`), excluída de `tsconfig.json`, `tsconfig.build.json` e `.gitignore`.
  - No Windows/Docker Desktop o watch do `nest start` não recebe eventos de arquivo do bind mount: após editar o código do worker é preciso `docker compose restart video-worker`.
  - Parada: `docker compose stop` envia SIGTERM ao wrapper `npm`/`nest start --watch`; o encerramento gracioso do processo Nest (`enableShutdownHooks`) não foi observável nos logs desse wrapper. Jobs interrompidos são devolvidos à fila pela recuperação de *stalled jobs* do BullMQ quando o lock expira.
  - Sessão interrompida por travamento da máquina durante o smoke; Docker reiniciado, stack e worker de pé novamente e o smoke re-executado com sucesso.

### SI-03.14 — Endpoint GET /videos/:slug
- **Status:** completed
- **Tests:** 5/5 e2e passing (test/videos-get.e2e-spec.ts, gerado da spec `specs/videos-get.plan.md`, pipeline completo: upload direto ao MinIO → job na fila Redis → worker in-process com FFmpeg → `ready`); videos.service.integration-spec.ts 16/16 (4 novos de `findReadyBySlug`)
- **Observations:**
  - A montagem de `thumbnail_url` (pré-assinatura) fica no serviço (`getPublicVideo`), não no DTO/controller.
  - Helpers de e2e ampliados: `startInProcessWorker` (contexto `WorkerModule` no processo de teste, prefixo de fila de teste), `uploadFixture` e `waitForVideoStatus`. O `beforeAll` que sobe API + worker precisa de timeout maior (60 s) que o padrão de 5 s do Jest neste bind mount do Windows — sem isso o teardown no meio do boot gera erros enganosos de `ioredis`.

### SI-03.15 — Endpoint GET /videos/:slug/stream
- **Status:** completed
- **Tests:** 4/4 e2e passing (test/videos-stream.e2e-spec.ts, gerado da spec `specs/videos-stream.plan.md`: `302` para URL pré-assinada; `Range` inicial e no meio do arquivo → `206` com `Content-Range` e bytes idênticos ao fixture); videos.service.integration-spec.ts 18/18 (2 novos de `getStreamUrl`)
- **Observations:**
  - O streaming não passa pela API: o storage atende os `Range` requests direto (conforme TD-11 e o diagrama C4).

### SI-03.16 — Endpoint GET /videos/:slug/download
- **Status:** completed
- **Tests:** 3/3 e2e passing (test/videos-download.e2e-spec.ts, gerado da spec `specs/videos-download.plan.md`: `302`, storage responde `Content-Disposition: attachment; filename="sample.mp4"` com o arquivo byte a byte idêntico); videos.service.integration-spec.ts 21/21 (3 novos de `getDownloadUrl`)
- **Observations:**
  - `original_filename` vem do cliente e vai para o header `Content-Disposition`: o serviço o restringe a ASCII imprimível sem aspas/barras (sem CR/LF), evitando header injection — coberto por teste de integração.

### SI-03.17 — Atualizar contrato OpenAPI e documentação de IA da fase
- **Status:** completed
- **Tests:** 10/10 passing (openapi-export.integration-spec.ts, 1 novo: 6 caminhos de vídeo com `security` correto — autenticados com `access-token`, públicos sem); verificação mecânica de que todo caminho, script e serviço citados nos `CLAUDE.md` existe
- **Observations:**
  - `openapi.json` regerado (6 caminhos de vídeo, erros referenciando `ApiErrorEnvelope`, `302` documentado em stream/download); `api.http` com o fluxo de vídeo (passos 10–16).
  - `CLAUDE.md` raiz: fila deixa de ser TBD (BullMQ on Redis), serviços `minio`/`minio-init`/`redis`/`video-worker`, fluxo de upload/processamento; a linha "`next-frontend/` — not yet initialized" estava desatualizada desde a Fase 02 e foi corrigida. `docs/diagrams/software-arch.mermaid`: fila `TBD` → `BullMQ on Redis`.
  - `nestjs-project/CLAUDE.md`: verificação de prontidão dos novos serviços, scripts do worker, setup do Jest (prefixo de fila de teste), override de lint em testes e seção "Videos (Fase 03)".
  - Testing guide (`external-systems.md`, `SKILL.md`, `artifacts/services.md`): Object Storage passa a MinIO real e Message Queue a BullMQ/Redis com prefixo de teste — resolução do IC-1 da validação.
  - **Follow-up (pré-existente, fora do escopo):** o `npm run openapi:export` roda via `ts-node`, que não aplica o plugin CLI do `@nestjs/swagger`; os schemas de DTOs de **entrada** saem sem propriedades — inclusive `RegisterDto`/`LoginDto` no `openapi.json` versionado da Fase 02. DTOs de resposta (com `@ApiProperty`) saem completos. _Resolvido depois em `bugfix/openapi-export-request-schemas`._
