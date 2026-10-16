# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 1/17 completed

### SI-03.1 — Instalar dependências e namespaces de configuração da fase
- **Status:** completed
- **Tests:** 11/11 passing (env.validation.integration-spec.ts); `test/app.e2e-spec.ts` 1/1; `tsc --noEmit` exit 0
- **Observations:**
  - `forcePathStyle` confirmado em `@aws-sdk/client-s3` `dist-types/endpoint/EndpointParameters.d.ts` (`ClientInputEndpointParameters`) — fecha a pendência registrada em `library-refs.md`.
  - `S3_ACCESS_KEY`/`S3_SECRET_KEY` passaram a ser obrigatórios: `requiredEnv` do teste de schema foi estendido para manter os casos existentes verdes.

### SI-03.2 — Infra: subir MinIO, Redis e FFmpeg no Docker Compose
- **Status:** pending
- **Tests:** pending
- **Observations:** none

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
