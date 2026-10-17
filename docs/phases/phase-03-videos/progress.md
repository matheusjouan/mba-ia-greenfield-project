# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 4/17 completed

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
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.6 — Configurar a fila video-processing e o produtor de jobs
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.7 — Retomar e concluir o upload, disparando o processamento
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.8 — Endpoint POST /videos
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.9 — Endpoint GET /videos/:slug/upload
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.10 — Endpoint POST /videos/:slug/upload/complete
- **Status:** pending
- **Tests:** pending
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
