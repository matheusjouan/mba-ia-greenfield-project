# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 10/17 completed

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
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.12 — Processar o vídeo no worker e fechar o ciclo de status
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.13 — Subir o worker de vídeo como processo e serviço Compose próprios
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.14 — Endpoint GET /videos/:slug
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.15 — Endpoint GET /videos/:slug/stream
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.16 — Endpoint GET /videos/:slug/download
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.17 — Atualizar contrato OpenAPI e documentação de IA da fase
- **Status:** pending
- **Tests:** pending
- **Observations:** none
