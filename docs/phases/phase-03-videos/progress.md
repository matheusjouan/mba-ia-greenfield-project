# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 2/17 completed

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
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.4 — Criar entidade Video, VideosModule e migration CreateVideos
- **Status:** pending
- **Tests:** pending
- **Observations:** none

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
