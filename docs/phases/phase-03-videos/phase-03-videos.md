---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-16T16:40:16-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-10-16T16:40:51-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-16T16:38:04-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-10-16T13:43:58-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Entregar o upload de vídeos de até 10GB direto ao object storage (sem passar pela API), com pré-cadastro automático do vídeo como rascunho, processamento automático em segundo plano por fila e worker (extração de duração/metadados e geração de thumbnail), URL única por vídeo, reprodução via streaming e download — deixando storage, fila e worker funcionando via Docker Compose.

---

## Step Implementations

### SI-03.1 — Instalar dependências e namespaces de configuração da fase

**Description:** Instala as bibliotecas de fila e S3 e cria os namespaces `storage`, `queue` e `video` com validação Joi, seguindo o padrão `registerAs` herdado da Fase 01 — base de configuração para todos os SIs seguintes.

**Technical actions:**

1. Instalar em `nestjs-project`: `bullmq@^6.3.15`, `@nestjs/bullmq@^12.0.0`, `@aws-sdk/client-s3@^3.1152.0`, `@aws-sdk/s3-request-presigner@^3.1152.0` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`) e confirmar no `.d.ts` instalado o nome da opção `forcePathStyle` de `S3ClientConfig` (pendência registrada em `library-refs.md`)
2. Criar `src/config/storage.config.ts` — `registerAs('storage', ...)` lendo `S3_ENDPOINT` (default `'http://minio:9000'`), `S3_PUBLIC_ENDPOINT` (default = valor de `S3_ENDPOINT`), `S3_REGION` (default `'us-east-1'`), `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` (default `'streamtube'`) (per `phase-03-videos/TD-04`)
3. Criar `src/config/queue.config.ts` — `registerAs('queue', ...)` com `REDIS_HOST` (default `'redis'`), `REDIS_PORT` (default `6379`), `QUEUE_PREFIX` (default `'bull'`) (per `phase-03-videos/TD-01`); e `src/config/video.config.ts` — `registerAs('video', ...)` com `VIDEO_MAX_FILE_SIZE_BYTES` (`10737418240`), `VIDEO_UPLOAD_PART_SIZE_BYTES` (`104857600`), `VIDEO_UPLOAD_URL_EXPIRATION_SECONDS` (`3600`), `VIDEO_PLAYBACK_URL_EXPIRATION_SECONDS` (`14400`) (per `phase-03-videos/TD-03`, `phase-03-videos/TD-11`)
4. Estender `src/config/env.validation.ts` — `S3_ACCESS_KEY` e `S3_SECRET_KEY` obrigatórios; `VIDEO_UPLOAD_PART_SIZE_BYTES` com mínimo `5242880` (mínimo S3 de parte); demais com defaults — e atualizar `.env.example` usando nomes de serviço do Compose (`S3_ENDPOINT=http://minio:9000`, `REDIS_HOST=redis`) (per `phase-01-configuracao-base/TD-02`)
5. Carregar `storageConfig`, `queueConfig` e `videoConfig` em `ConfigModule.forRoot({ load })` no `AppModule` (per `phase-01-configuracao-base/TD-03`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `envValidationSchema` | Integration: bootstrap falha sem `S3_ACCESS_KEY`; parte < 5 MiB rejeitada; defaults de vídeo aplicados | `src/config/env.validation.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Inicializar a aplicação sem `S3_ACCESS_KEY` gera erro de validação Joi no bootstrap e a aplicação não sobe
- Inicializar com `VIDEO_UPLOAD_PART_SIZE_BYTES=1048576` gera erro de validação Joi no bootstrap
- Com os valores de `.env.example`, `GET /` continua retornando `200` (suítes existentes verdes)
- Sem variáveis de vídeo definidas, `video.maxFileSizeBytes` resolve para `10737418240` e `video.uploadPartSizeBytes` para `104857600`

---

### SI-03.2 — Infra: subir MinIO, Redis e FFmpeg no Docker Compose

**Description:** Adiciona ao `compose.yaml` o object storage (MinIO + bucket provisionado), o broker da fila (Redis) e instala FFmpeg na imagem de desenvolvimento — a infraestrutura real que storage, fila e worker usam e que os testes exercitam.

**Technical actions:**

1. Adicionar `ffmpeg` (inclui `ffprobe`) ao `apt install` de `nestjs-project/Dockerfile.dev` e reconstruir a imagem (per `phase-03-videos/TD-07`)
2. Adicionar serviço `minio` — imagem `cgr.dev/chainguard/minio@sha256:2136d593beacf4461187035eca949fe49abd589d5079735025c711ca58fee0c8`, comando `server /data --console-address :9001`, `MINIO_ROOT_USER=${S3_ACCESS_KEY}`, `MINIO_ROOT_PASSWORD=${S3_SECRET_KEY}`, `MINIO_API_STALE_UPLOADS_EXPIRY=24h`, portas `9000`/`9001`, volume nomeado e healthcheck (per `phase-03-videos/TD-05`, `phase-03-videos/TD-15`)
3. Adicionar serviço one-shot `minio-init` — imagem `cgr.dev/chainguard/minio-client@sha256:d8a93c5d335509ff353774eefec8f82fa2a2a975e800139702232d8be3dbe6b9`, `MC_HOST_local=http://${S3_ACCESS_KEY}:${S3_SECRET_KEY}@minio:9000`, comando `mb --ignore-existing local/${S3_BUCKET}`, `depends_on: minio (service_healthy)` (per `phase-03-videos/TD-04`)
4. Adicionar serviço `redis` — `redis:8-alpine` com `redis-server --appendonly yes --maxmemory-policy noeviction`, healthcheck `redis-cli ping` e volume nomeado (per `phase-03-videos/TD-01`)
5. Fazer `nestjs-api` depender de `redis` (`service_healthy`) e `minio-init` (`service_completed_successfully`)

**Tests:** _(empty — Infra)_

**Dependencies:** SI-03.1 — o Compose interpola `S3_ACCESS_KEY`, `S3_SECRET_KEY` e `S3_BUCKET` do `.env`

**Acceptance criteria:**

- `docker compose up -d` deixa `minio` e `redis` com status `healthy` e `minio-init` finalizado com exit code `0`
- O bucket `streamtube` existe no MinIO após o `up` (listável via `mc ls`) e um segundo `up` não falha (`--ignore-existing`)
- `docker compose exec nestjs-api ffprobe -version` e `ffmpeg -version` retornam exit code `0`
- `docker compose exec redis redis-cli config get maxmemory-policy` retorna `noeviction`
- A configuração `api` do MinIO reporta `stale_uploads_expiry=24h`

---

### SI-03.3 — Criar StorageModule para multipart, URLs pré-assinadas e objetos

**Description:** Encapsula todo acesso ao object storage S3-compatível em `StorageService` (único responsável pelo SDK da AWS), com cliente interno e cliente de pré-assinatura separados e mapeamento de erros do S3 para exceções de domínio.

**Technical actions:**

1. Criar `src/storage/storage.service.ts` com dois `S3Client` (`S3_ENDPOINT` para operações; `S3_PUBLIC_ENDPOINT` para pré-assinar URLs entregues a clientes; ambos `forcePathStyle: true`) e os métodos de multipart: `createMultipartUpload(key, contentType)`, `presignUploadPart(key, uploadId, partNumber, expiresIn)`, `listParts(key, uploadId)` (paginando `NextPartNumberMarker`), `completeMultipartUpload(key, uploadId, parts)`, `abortMultipartUpload(key, uploadId)` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-04`)
2. Adicionar os métodos de objeto: `headObject(key)` → `{ contentLength }`, `putObject(key, body, contentType)`, `deleteObject(key)` e `presignGetObject(key, { expiresIn, endpoint: 'public' | 'internal', downloadFileName? })` — com `downloadFileName` assina `ResponseContentDisposition: attachment; filename="..."` (per `phase-03-videos/TD-08`, `phase-03-videos/TD-11`)
3. Adicionar `UploadExpiredException` (`UPLOAD_EXPIRED`, 410) e `InvalidUploadPartsException` (`INVALID_UPLOAD_PARTS`, 400) em `src/common/exceptions/domain.exception.ts`; `StorageService` converte `NoSuchUpload` → `UploadExpiredException` e `InvalidPart` / `InvalidPartOrder` / `EntityTooSmall` → `InvalidUploadPartsException`; demais erros propagam sem alteração (per `### Error Catalog`)
4. Criar `src/storage/storage.module.ts` — provider e export de `StorageService`, configuração injetada via `storageConfig.KEY` (per `phase-01-configuracao-base/TD-03`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Integration: MinIO real — multipart de 2 partes via PUT nas URLs pré-assinadas + `listParts` + `complete` + `headObject`; GET pré-assinado com `Range` → `206`; `Content-Disposition` de download; mapeamento `NoSuchUpload` e `InvalidPart` | `src/storage/storage.service.integration-spec.ts` |
| `StorageModule` | Unit: compilação do módulo com `storageConfig` | `src/storage/storage.module.spec.ts` |

**Dependencies:** SI-03.1 — `storageConfig` e SDK instalados; SI-03.2 — MinIO e bucket disponíveis

**Acceptance criteria:**

- Um buffer de 6 MiB enviado em 2 partes por `PUT` nas URLs de `presignUploadPart` e concluído com os `ETag`s retornados gera um objeto cujo `headObject` reporta `contentLength = 6291456`
- `GET` numa URL de `presignGetObject` com `Range: bytes=0-99` retorna `206` com `Content-Range: bytes 0-99/6291456`
- `GET` numa URL de `presignGetObject` com `downloadFileName: "clip.mp4"` retorna `Content-Disposition: attachment; filename="clip.mp4"`
- `listParts` ou `completeMultipartUpload` com um `uploadId` inexistente lança `UploadExpiredException` (`UPLOAD_EXPIRED`)
- `completeMultipartUpload` com um `ETag` que não corresponde à parte lança `InvalidUploadPartsException` (`INVALID_UPLOAD_PARTS`)
- URLs pré-assinadas com `endpoint: 'public'` usam o host de `S3_PUBLIC_ENDPOINT`; com `endpoint: 'internal'`, o host de `S3_ENDPOINT`

---

### SI-03.4 — Criar entidade Video, VideosModule e migration CreateVideos

**Description:** Cria a tabela `videos` ligada ao canal, com o enum de status do ciclo de vida, o slug único e as chaves de storage — a persistência sobre a qual upload, fila e worker operam.

**Technical actions:**

1. Criar `src/videos/videos.constants.ts` (enum `VideoStatus` = `draft` | `processing` | `ready` | `failed`, allowlist `VIDEO_ALLOWED_MIME_TYPES`, `VIDEO_SLUG_LENGTH = 11`) e `src/videos/entities/video.entity.ts` — `@Entity('videos')` com as colunas de `### Data Model → Video`, transformer `bigint → number` em `file_size` e `@ManyToOne(() => Channel, (channel) => channel.videos, { onDelete: 'CASCADE' })` + `@JoinColumn({ name: 'channel_id' })` (per `phase-03-videos/TD-10`, `phase-03-videos/TD-12`)
2. Adicionar o lado inverso `@OneToMany(() => Video, (video) => video.channel) videos` em `src/channels/entities/channel.entity.ts` (sem mudança de schema em `channels`)
3. Criar `src/videos/videos.module.ts` com `TypeOrmModule.forFeature([Video])` e registrá-lo no `AppModule`
4. Gerar `npm run migration:generate -- src/database/migrations/CreateVideos` e revisar o SQL (enum `videos_status_enum`, `UNIQUE(slug)`, FK `channel_id` com `ON DELETE CASCADE`, índice em `channel_id`)
5. Atualizar `src/database/migrations.integration-spec.ts` (`videos` em `MANAGED_TABLES`, `videos_status_enum` em `MANAGED_ENUM_TYPES`, migration `CreateVideos` no array, 3 migrations esperadas) e `cleanAllTables` em `src/test/create-test-data-source.ts` (apagar `videos` antes de `channels`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: slug único, `status` default `draft`, enum rejeita valor inválido, cascade ao apagar o canal, `file_size` de 10 GiB lido como `number` | `src/videos/entities/video.entity.integration-spec.ts` |
| Migrations | Integration: aplica as 3 migrations criando `videos`; revert da última remove `videos` e o enum | `src/database/migrations.integration-spec.ts` |
| `VideosModule` | Unit: compilação com `TypeOrmModule.forFeature([Video])` | `src/videos/videos.module.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- `npm run migration:run` cria `videos` com o tipo `videos_status_enum`, índice único em `slug` e FK `channel_id → channels.id` com `ON DELETE CASCADE`
- Inserir dois vídeos com o mesmo `slug` falha com violação de unicidade
- Um vídeo inserido sem `status` é persistido como `'draft'`; inserir `status = 'published'` falha no enum
- Um vídeo com `file_size = 10737418240` é lido de volta como o número `10737418240`
- Apagar um canal remove seus vídeos
- `npm run migration:revert` remove a tabela `videos` e o tipo `videos_status_enum`

---

### SI-03.5 — Pré-cadastrar vídeo como rascunho ao iniciar o upload

**Description:** Implementa `VideosService.initiateUpload`: gera a URL única, abre o multipart upload no storage e persiste o vídeo em `draft` no canal do usuário, devolvendo as URLs pré-assinadas das partes — o arquivo nunca passa pela API.

**Technical actions:**

1. Criar `src/videos/video-slug.util.ts` — `generateVideoSlug()` retorna 11 caracteres base64url a partir de `crypto.randomBytes` (per `phase-03-videos/TD-10`)
2. Adicionar `ChannelsService.findByUserId(userId): Promise<Channel | null>` em `src/channels/channels.service.ts` (o canal é do domínio de canais — SRP) e importar `ChannelsModule` e `StorageModule` no `VideosModule`
3. Criar `src/videos/videos.service.ts` com `initiateUpload(userId, { fileName, fileSize, mimeType, title? })`: rejeitar `fileSize > video.maxFileSizeBytes` com `VideoFileTooLargeException` antes de tocar o storage; `id = crypto.randomUUID()`; `storage_key = videos/{id}/source{.ext}`; `createMultipartUpload`; `title` default = `fileName` sem extensão (per `phase-03-videos/TD-03`, `phase-03-videos/TD-04`, `phase-03-videos/TD-12`)
4. Persistir o `Video` em `draft` com retry de slug: em violação de unicidade de `slug` (`23505`), gerar novo slug (máx. 5 tentativas); se o insert falhar de forma irrecuperável, compensar com `abortMultipartUpload` e relançar o erro; retornar `part_size`, `part_count = ceil(file_size / part_size)`, `expires_at` e as URLs de `presignUploadPart` de todas as partes (per `phase-03-videos/TD-02`, `phase-03-videos/TD-10`)
5. Adicionar `VideoFileTooLargeException` (`VIDEO_FILE_TOO_LARGE`, 400) em `src/common/exceptions/domain.exception.ts` e exportar `VideosService` no `VideosModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `generateVideoSlug` | Unit: 11 caracteres, alfabeto base64url, sem repetição em 10 000 gerações | `src/videos/video-slug.util.spec.ts` |
| `VideosService` | Unit: tamanho acima do limite não chama o storage; retry em colisão de slug; compensação `abortMultipartUpload`; cálculo de `part_count`; título default | `src/videos/videos.service.spec.ts` |
| `VideosService` | Integration: DB + MinIO reais — linha `draft` com `storage_key`/`upload_id`; URL de parte aceita `PUT`; compensação aborta o upload | `src/videos/videos.service.integration-spec.ts` |
| `ChannelsService` | Integration: `findByUserId` retorna o canal do usuário e `null` para usuário sem canal | `src/channels/channels.service.integration-spec.ts` |

**Dependencies:** SI-03.3 — `StorageService`; SI-03.4 — entidade `Video` e `VideosModule`

**Acceptance criteria:**

- `initiateUpload` para um mp4 declarado com 25 MiB persiste um vídeo `draft` com `upload_id` não nulo, `storage_key = videos/{id}/source.mp4` e retorna `part_count = 1`
- `initiateUpload` com `fileSize = 10737418241` lança `VIDEO_FILE_TOO_LARGE`, sem criar linha em `videos` nem multipart upload
- Com `fileName = "My Clip.mp4"` e sem `title`, o vídeo é criado com `title = "My Clip"`
- Quando o slug gerado já existe, o vídeo é persistido com outro slug — dois vídeos nunca compartilham `slug`
- Se a persistência falhar, o multipart upload criado é abortado (`listParts` passa a lançar `UPLOAD_EXPIRED`)

---

### SI-03.6 — Configurar a fila video-processing e o produtor de jobs

**Description:** Conecta a aplicação ao Redis via BullMQ e cria o produtor do job `process-video` com o contrato de `### Events/Messages`, isolando os testes num prefixo de fila próprio para não competir com o worker do Compose.

**Technical actions:**

1. Registrar `BullModule.forRootAsync({ inject: [queueConfig.KEY], useFactory: (config) => ({ connection: { host, port }, prefix }) })` no `AppModule` (per `phase-03-videos/TD-01`)
2. Criar `src/queues/queues.constants.ts` — `VIDEO_PROCESSING_QUEUE = 'video-processing'`, `PROCESS_VIDEO_JOB = 'process-video'`, interface `ProcessVideoJobData { videoId: string }` e as opções `attempts: 3`, `backoff: { type: 'exponential', delay: 5000 }`, `removeOnComplete: true`, `removeOnFail: false` (per `phase-03-videos/TD-12`, `phase-03-videos/TD-13`)
3. Criar `src/queues/video-processing.producer.ts` — `enqueue(videoId)` chama `queue.add(PROCESS_VIDEO_JOB, { videoId }, { ...opções, jobId: videoId })` via `@InjectQueue(VIDEO_PROCESSING_QUEUE)` (per `phase-03-videos/TD-13`)
4. Criar `src/queues/queues.module.ts` — `BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE })`, provider e export de `VideoProcessingProducer` (sem `@Processor` — a API nunca consome, per `phase-03-videos/TD-06`)
5. Criar `src/test/jest-setup-env.ts` (define `QUEUE_PREFIX=streamtube-test` quando ausente) e adicioná-lo a `setupFiles` do Jest unit/integration (`package.json`) e e2e (`test/jest-e2e.json`), para que jobs de teste não sejam consumidos pelo `video-worker` do Compose (per `phase-03-videos/TD-14`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingProducer` | Integration: Redis real — job `process-video` em espera com `{ videoId }`, `jobId = videoId`, `attempts = 3`; segundo `enqueue` do mesmo id não duplica | `src/queues/video-processing.producer.integration-spec.ts` |
| `QueuesModule` | Unit: compilação com `BullModule.forRoot` + `registerQueue` | `src/queues/queues.module.spec.ts` |

**Dependencies:** SI-03.1 — `queueConfig`; SI-03.2 — serviço `redis`

**Acceptance criteria:**

- `enqueue(videoId)` deixa exatamente um job `process-video` na fila `video-processing` com `data = { videoId }` e `id = videoId`
- Chamar `enqueue` duas vezes com o mesmo `videoId` mantém um único job na fila
- O job criado tem `opts.attempts = 3` e `opts.backoff = { type: 'exponential', delay: 5000 }`
- Com apenas o `AppModule` em execução, a fila `video-processing` não possui workers registrados (`queue.getWorkers()` retorna lista vazia)
- Jobs criados pela suíte de testes ficam sob o prefixo `streamtube-test` e não aparecem sob o prefixo `bull` usado pelo `video-worker`

---

### SI-03.7 — Retomar e concluir o upload, disparando o processamento

**Description:** Implementa no `VideosService` a consulta do upload (retomada por partes) e a conclusão do multipart, que valida o tamanho armazenado, move o vídeo para `processing` e publica o job — a transição `draft → processing` pertence à API.

**Technical actions:**

1. Adicionar `VideoNotFoundException` (`VIDEO_NOT_FOUND`, 404), `VideoNotInDraftException` (`VIDEO_NOT_IN_DRAFT`, 409) e `UploadSizeMismatchException` (`UPLOAD_SIZE_MISMATCH`, 400) em `src/common/exceptions/domain.exception.ts` e um helper privado `findOwnedBySlug(userId, slug)` no `VideosService` que lança `VideoNotFoundException` quando o slug não existe ou o canal do vídeo não pertence ao usuário (per `### Authorization Matrix`)
2. Implementar `getUploadStatus(userId, slug)` — retorna `status` e `processing_error`; enquanto `draft`, consulta `listParts` e pré-assina URLs apenas das partes ainda não enviadas (per `phase-03-videos/TD-02`)
3. Implementar `completeUpload(userId, slug, parts)` — exige `status = 'draft'` (`VIDEO_NOT_IN_DRAFT`); conclui o multipart com as partes ordenadas por `part_number`; se `headObject.contentLength ≠ file_size`, apaga o objeto, grava `status = 'failed'` com `processing_error` e lança `UploadSizeMismatchException` (per `phase-03-videos/TD-03`)
4. Em caso de sucesso, gravar `status = 'processing'` e `upload_id = null`, e então chamar `VideoProcessingProducer.enqueue(video.id)`; se o enqueue falhar, gravar `status = 'failed'` com `processing_error` e relançar (per `phase-03-videos/TD-12`, `phase-03-videos/TD-13`)
5. Importar `QueuesModule` no `VideosModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` | Unit: não-dono → `VIDEO_NOT_FOUND`; fora de `draft` → `VIDEO_NOT_IN_DRAFT`; tamanho divergente → objeto apagado + `failed`; falha no enqueue → `failed`; retomada exclui partes já enviadas | `src/videos/videos.service.spec.ts` |
| `VideosService` | Integration: DB + MinIO + Redis reais — 1ª parte enviada aparece em `uploaded_parts`; `completeUpload` → `processing` + job enfileirado; caminho de tamanho divergente | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.5 — `initiateUpload` e vídeo `draft`; SI-03.6 — `VideoProcessingProducer`

**Acceptance criteria:**

- Após o `PUT` da parte 1 de um upload de 2 partes, `getUploadStatus` retorna `uploaded_parts` com a parte 1 e `parts` contendo apenas a URL da parte 2
- `completeUpload` com os `ETag`s corretos grava `status = 'processing'`, `upload_id = null` e deixa um job `process-video` com `{ videoId }` na fila
- `completeUpload` de um vídeo cujo objeto final tem tamanho diferente do declarado lança `UPLOAD_SIZE_MISMATCH`, remove o objeto e grava `status = 'failed'` com `processing_error`
- `completeUpload` num vídeo já em `processing` lança `VIDEO_NOT_IN_DRAFT`
- `getUploadStatus` / `completeUpload` chamados por um usuário que não é dono lançam `VIDEO_NOT_FOUND`
- `getUploadStatus` de um `draft` cujo multipart expirou lança `UPLOAD_EXPIRED`

---

### SI-03.8 — Endpoint POST /videos

**Route:** POST /videos
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Authenticated

**Description:** Expõe o início do upload: valida o payload, pré-cadastra o vídeo como rascunho no canal do usuário autenticado e devolve as URLs pré-assinadas das partes (per `### API Contracts → POST /videos`).

**Technical actions:**

1. Criar `src/videos/dto/create-video.dto.ts` — `file_name`, `file_size`, `mime_type` (`@IsIn(VIDEO_ALLOWED_MIME_TYPES)`), `title?` conforme `#### Validation Rules — Videos`, só `class-validator` + JSDoc (plugin Swagger) (per `phase-02-auth/TD-06`, `openapi-docs-nestjs/TD-01`)
2. Criar os DTOs de resposta `src/videos/dto/video-upload.response.dto.ts` (`VideoUploadResponseDto`, `UploadSessionDto`, `UploadPartUrlDto`) com `@ApiProperty` em todos os campos (regra de DTO de resposta)
3. Criar `src/videos/videos.controller.ts` — `@ApiTags('videos') @Controller('videos')`; `@Post() @HttpCode(201) @ApiBearerAuth('access-token')` delegando a `videosService.initiateUpload(user.sub, dto)` com `@CurrentUser()`; `@ApiOperation` + `@ApiResponse` para `201`, `400` e `401` usando `ApiErrorEnvelope`
4. Registrar `VideosController` no `VideosModule`

**Tests:** _(empty — controller + DTO wiring covered by the E2E spec authored by /plan-test-specs)_

**Dependencies:** SI-03.5 — `VideosService.initiateUpload`

**Acceptance criteria:**

- `POST /videos` com token válido e `{ file_name: "clip.mp4", file_size: 1048576, mime_type: "video/mp4" }` retorna `201` com `id`, `slug` de 11 caracteres, `title: "clip"`, `status: "draft"` e `upload.parts` com 1 item contendo `part_number: 1` e `url`
- `POST /videos` sem `Authorization` retorna `401`
- `POST /videos` com `mime_type: "image/png"` retorna `400` com `error: "VALIDATION_ERROR"`
- `POST /videos` com `file_size: 10737418241` retorna `400` com `error: "VIDEO_FILE_TOO_LARGE"`
- `POST /videos` com campo desconhecido no body retorna `400` com `error: "VALIDATION_ERROR"`
- Um `PUT` com bytes do arquivo na `upload.parts[0].url` retornada é aceito pelo storage (`200` com header `ETag`)

---

### SI-03.9 — Endpoint GET /videos/:slug/upload

**Route:** GET /videos/:slug/upload
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Owner

**Description:** Expõe ao dono o estado do pipeline do vídeo e, enquanto `draft`, os dados de retomada do upload (partes já enviadas + URLs das faltantes) (per `### API Contracts → GET /videos/:slug/upload`).

**Technical actions:**

1. Criar `src/videos/dto/upload-status.response.dto.ts` (`UploadStatusResponseDto`, `UploadResumeDto`, `UploadedPartDto`) com `@ApiProperty`, incluindo `processing_error` e `upload` como `nullable`
2. Adicionar `@Get(':slug/upload') @ApiBearerAuth('access-token')` em `VideosController` delegando a `videosService.getUploadStatus(user.sub, slug)`
3. Documentar `@ApiResponse` `200`, `401`, `404` (`VIDEO_NOT_FOUND`) e `410` (`UPLOAD_EXPIRED`) com `ApiErrorEnvelope`

**Tests:** _(empty — controller wiring covered by the E2E spec authored by /plan-test-specs)_

**Dependencies:** SI-03.7 — `getUploadStatus`; SI-03.8 — `VideosController`

**Acceptance criteria:**

- `GET /videos/:slug/upload` pelo dono de um vídeo `draft` com a parte 1 já enviada retorna `200` com `status: "draft"`, `upload.uploaded_parts` contendo `part_number: 1` e `upload.parts` sem a parte 1
- `GET /videos/:slug/upload` pelo dono de um vídeo em `processing` retorna `200` com `status: "processing"` e `upload: null`
- `GET /videos/:slug/upload` com token de outro usuário retorna `404` com `error: "VIDEO_NOT_FOUND"`
- `GET /videos/:slug/upload` sem `Authorization` retorna `401`
- `GET /videos/:slug/upload` com slug inexistente retorna `404` com `error: "VIDEO_NOT_FOUND"`

---

### SI-03.10 — Endpoint POST /videos/:slug/upload/complete

**Route:** POST /videos/:slug/upload/complete
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Owner

**Description:** Expõe a conclusão do upload, que fecha o multipart no storage, coloca o vídeo em `processing` e dispara o processamento automático (per `### API Contracts → POST /videos/:slug/upload/complete`).

**Technical actions:**

1. Criar `src/videos/dto/complete-upload.dto.ts` — `parts` (`@IsArray`, `@ArrayMinSize(1)`, `@ArrayMaxSize(10000)`, `@ValidateNested({ each: true })`, `@Type(() => UploadedPartInputDto)`) com `part_number` (inteiro 1..10000) e `etag` (string não vazia) conforme `#### Validation Rules — Videos`
2. Criar `src/videos/dto/video-summary.response.dto.ts` (`id`, `slug`, `title`, `status`) com `@ApiProperty`
3. Adicionar `@Post(':slug/upload/complete') @HttpCode(200) @ApiBearerAuth('access-token')` em `VideosController` delegando a `videosService.completeUpload(user.sub, slug, dto.parts)`
4. Documentar `@ApiResponse` `200`, `400` (`VALIDATION_ERROR`, `INVALID_UPLOAD_PARTS`, `UPLOAD_SIZE_MISMATCH`), `401`, `404`, `409` (`VIDEO_NOT_IN_DRAFT`) e `410` (`UPLOAD_EXPIRED`) com `ApiErrorEnvelope`

**Tests:** _(empty — controller + DTO wiring covered by the E2E spec authored by /plan-test-specs)_

**Dependencies:** SI-03.7 — `completeUpload`; SI-03.8 — `VideosController`

**Acceptance criteria:**

- `POST /videos/:slug/upload/complete` pelo dono, com as partes enviadas e seus `ETag`s, retorna `200` com `status: "processing"` e o vídeo passa a `processing` no banco
- Repetir a chamada para o mesmo vídeo retorna `409` com `error: "VIDEO_NOT_IN_DRAFT"`
- `POST /videos/:slug/upload/complete` com um `etag` que não corresponde à parte retorna `400` com `error: "INVALID_UPLOAD_PARTS"`
- `POST /videos/:slug/upload/complete` com `parts: []` retorna `400` com `error: "VALIDATION_ERROR"`
- `POST /videos/:slug/upload/complete` com token de outro usuário retorna `404` com `error: "VIDEO_NOT_FOUND"`

---

### SI-03.11 — Extrair metadados e thumbnail com ffprobe/ffmpeg

**Description:** Cria o `MediaProbeService`, que invoca os binários oficiais do FFmpeg sobre uma URL HTTP (lendo só os bytes necessários via Range) para extrair duração/metadados e gerar o thumbnail — o núcleo técnico do processamento.

**Technical actions:**

1. Criar `src/video-worker/media-probe.parser.ts` — função pura `parseFfprobeOutput(json)` → `MediaProbeResult { durationSeconds, width, height, formatName, bitRate, videoCodec, audioCodec, frameRate }` (converte `r_frame_rate` fracionário, ex. `30000/1001` → `29.97`); lança `InvalidMediaError` quando não há stream de vídeo ou duração (per `phase-03-videos/TD-07`)
2. Criar `src/video-worker/media-probe.service.ts` — `probe(input)` executa `ffprobe -v error -print_format json -show_format -show_streams <input>` via `node:child_process` (`spawn`, sem shell) com timeout; exit code ≠ 0 → `InvalidMediaError` com o `stderr` (per `phase-03-videos/TD-07`, `phase-03-videos/TD-08`)
3. Adicionar `extractThumbnail(input, atSeconds, outputPath)` — `ffmpeg -ss <atSeconds> -i <input> -frames:v 1 -vf "scale='min(1280,iw)':-2" -q:v 3 -y <outputPath>` (per `phase-03-videos/TD-09`)
4. Gerar com ffmpeg e versionar o fixture `test/fixtures/sample.mp4` (3 s, 320x240, H.264 + AAC, `-movflags +faststart`, poucos KB) (per `phase-03-videos/TD-14`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `parseFfprobeOutput` | Unit: JSON completo → resultado; sem áudio → `audioCodec: null`; sem stream de vídeo → `InvalidMediaError`; frame rate fracionário | `src/video-worker/media-probe.parser.spec.ts` |
| `MediaProbeService` | Integration: ffprobe/ffmpeg reais sobre o fixture (caminho local e URL pré-assinada do MinIO) → duração ≈ 3 s, 320x240, `h264`; thumbnail JPEG gerado; bytes aleatórios → `InvalidMediaError` | `src/video-worker/media-probe.service.integration-spec.ts` |

**Dependencies:** SI-03.2 — FFmpeg na imagem; SI-03.3 — `presignGetObject` para o input HTTP

**Acceptance criteria:**

- `probe` sobre `test/fixtures/sample.mp4` retorna `durationSeconds` entre `2.9` e `3.1`, `width = 320`, `height = 240`, `videoCodec = "h264"` e `audioCodec = "aac"`
- `probe` sobre uma URL pré-assinada interna do mesmo arquivo no MinIO retorna os mesmos valores sem baixar o arquivo para disco
- `extractThumbnail` gera um arquivo JPEG válido (assinatura `FF D8 FF`) com largura ≤ 1280
- `probe` sobre um arquivo de bytes aleatórios lança `InvalidMediaError`

---

### SI-03.12 — Processar o vídeo no worker e fechar o ciclo de status

**Description:** Implementa o consumidor do job `process-video`: lê o vídeo, extrai metadados, gera e grava o thumbnail e move o vídeo para `ready`, ou para `failed` quando a última tentativa falha — as transições `processing → ready | failed` pertencem ao worker.

**Technical actions:**

1. Adicionar ao `VideosService` (dono da entidade `Video` — SRP) `findForProcessing(id)`, `markReady(id, result, thumbnailKey)` (grava `duration_seconds`, `width`, `height`, `metadata`, `thumbnail_key`, `processed_at`, `status = 'ready'`, `processing_error = null`) e `markFailed(id, message)` (per `phase-03-videos/TD-12`)
2. Criar `src/video-worker/video-processing.service.ts` — `process(videoId)`: encerra sem mudanças se o vídeo não existe ou não está em `processing`; pré-assina GET interno; `probe` (`InvalidMediaError` → `UnrecoverableError`); thumbnail em `durationSeconds * 0.1` num arquivo temporário → `putObject('videos/{videoId}/thumbnail.jpg', ..., 'image/jpeg')` → remove o temporário; `markReady` (per `phase-03-videos/TD-08`, `phase-03-videos/TD-09`, `phase-03-videos/TD-13`)
3. Criar `src/video-worker/video-processing.processor.ts` — `@Processor(VIDEO_PROCESSING_QUEUE)` estendendo `WorkerHost`; `process(job)` chama `videoProcessingService.process(job.data.videoId)`; `@OnWorkerEvent('failed')` chama `markFailed` somente quando o erro é `UnrecoverableError` ou `job.attemptsMade >= job.opts.attempts` (catch-and-log permitido em background, per `.claude/rules/nestjs-services.md`) (per `phase-03-videos/TD-12`)
4. Criar `src/video-worker/video-worker.module.ts` — importa `QueuesModule`, `VideosModule` e `StorageModule`; providers `MediaProbeService`, `VideoProcessingService`, `VideoProcessingProcessor` (per `phase-03-videos/TD-06`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingService` | Unit: ignora vídeo fora de `processing`; `InvalidMediaError` vira `UnrecoverableError`; thumbnail no instante 10% da duração | `src/video-worker/video-processing.service.spec.ts` |
| `VideoProcessingProcessor` | Unit: `failed` só marca o vídeo na última tentativa ou com `UnrecoverableError` | `src/video-worker/video-processing.processor.spec.ts` |
| `VideoProcessingService` | Integration: DB + MinIO + FFmpeg reais — fixture enviado → `ready` com duração/dimensões/metadados e objeto `thumbnail.jpg` existente; objeto corrompido → `UnrecoverableError` | `src/video-worker/video-processing.service.integration-spec.ts` |
| `VideoWorkerModule` | Unit: compilação com `BullModule` + `VideosModule` + `StorageModule` | `src/video-worker/video-worker.module.spec.ts` |

**Dependencies:** SI-03.7 — vídeos em `processing` e job publicado; SI-03.11 — `MediaProbeService`

**Acceptance criteria:**

- Processar um vídeo `processing` cujo objeto é o fixture grava `status = 'ready'`, `duration_seconds ≈ 3`, `width = 320`, `height = 240`, `metadata.video_codec = "h264"` e `processed_at` não nulo
- Após o processamento, o objeto `videos/{videoId}/thumbnail.jpg` existe no bucket com `Content-Type: image/jpeg` e `thumbnail_key` aponta para ele
- Processar um vídeo cujo objeto não é mídia válida grava `status = 'failed'` com `processing_error` preenchido, sem novas tentativas
- Uma falha transitória na 1ª tentativa mantém o vídeo em `processing`; só a falha da 3ª tentativa grava `failed`
- Processar o mesmo `videoId` duas vezes produz o mesmo estado final (`ready`, mesmo `thumbnail_key`)
- Um job para um vídeo que não está em `processing` (ex.: já `ready`) termina sem alterar a linha

---

### SI-03.13 — Subir o worker de vídeo como processo e serviço Compose próprios

**Description:** Cria o entrypoint `src/worker.ts` (contexto Nest sem HTTP) e o serviço `video-worker` no Compose, reaproveitando a configuração raiz da API sem duplicá-la — o container de worker isolado do diagrama C4.

**Technical actions:**

1. Extrair as opções raiz compartilhadas para funções reutilizáveis — opções do `ConfigModule.forRoot` (namespaces + Joi), factory do `TypeOrmModule.forRootAsync` e factory do `BullModule.forRootAsync` — e usá-las no `AppModule`, mantendo um único `databaseConfig` como fonte da conexão (per Inherited Conventions da Fase 01)
2. Criar `src/worker.module.ts` (raiz do worker: `ConfigModule`, `TypeOrmModule`, `BullModule` raiz e `VideoWorkerModule`, sem controllers) e `src/worker.ts` — `NestFactory.createApplicationContext(WorkerModule)` + `enableShutdownHooks()` para que o worker BullMQ encerre o job ativo com graça (per `phase-03-videos/TD-06`)
3. Adicionar scripts `start:worker` (build) e `start:worker:dev` (watch) no `package.json`, com saída de build separada da API para que `deleteOutDir` de um processo não apague a saída do outro (per `phase-03-videos/TD-06`)
4. Adicionar serviço `video-worker` ao `compose.yaml` — mesmo build de `Dockerfile.dev` e volume da API, comando `npm run start:worker:dev`, `depends_on` `db` (`service_healthy`), `redis` (`service_healthy`) e `minio-init` (`service_completed_successfully`), `restart: unless-stopped` (per `phase-03-videos/TD-06`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `WorkerModule` | Integration: contexto inicializa com DB/Redis reais, resolve `VideoProcessingProcessor` e registra um worker na fila `video-processing` | `src/worker.module.integration-spec.ts` |

**Dependencies:** SI-03.12 — `VideoWorkerModule`

**Acceptance criteria:**

- `docker compose up -d` deixa o serviço `video-worker` em execução e seus logs mostram o contexto Nest inicializado sem servidor HTTP
- Com o `video-worker` em execução, a fila `video-processing` (prefixo `bull`) possui 1 worker registrado
- Um upload concluído via API (`POST /videos/:slug/upload/complete`) com o fixture é processado pelo container `video-worker` e o vídeo chega a `status = 'ready'` em até 60 s
- `docker compose stop video-worker` encerra o processo sem deixar job ativo órfão (o job em andamento termina ou volta para a fila)
- Rodar a API (`start:dev`) e o worker (`start:worker:dev`) em watch ao mesmo tempo não faz um apagar a saída de build do outro

---

### SI-03.14 — Endpoint GET /videos/:slug

**Route:** GET /videos/:slug
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Anonymous

**Description:** Expõe publicamente, pela URL única, os metadados de um vídeo `ready` com a URL pré-assinada do thumbnail (per `### API Contracts → GET /videos/:slug`).

**Technical actions:**

1. Adicionar `VideosService.findReadyBySlug(slug)` — carrega o vídeo com `channel`; lança `VideoNotFoundException` quando não existe ou `status ≠ 'ready'` (AMB-2 clarification)
2. Criar `src/videos/dto/video.response.dto.ts` (`VideoResponseDto`, `VideoMetadataDto`, `VideoChannelDto`) com `@ApiProperty` e o mapeamento entidade → resposta, incluindo `thumbnail_url` via `presignGetObject(thumbnail_key, { endpoint: 'public', expiresIn: video.playbackUrlExpirationSeconds })` (per `phase-03-videos/TD-04`, `phase-03-videos/TD-11`)
3. Adicionar `@Public() @Get(':slug')` em `VideosController` (sem `@ApiBearerAuth`) com `@ApiResponse` `200` e `404` (`VIDEO_NOT_FOUND`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` | Integration: `findReadyBySlug` retorna vídeo `ready` com canal; `draft`/`processing`/`failed` → `VIDEO_NOT_FOUND` | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.12 — vídeos `ready` com thumbnail; SI-03.8 — `VideosController`

**Acceptance criteria:**

- `GET /videos/:slug` sem token, para um vídeo `ready`, retorna `200` com `status: "ready"`, `duration_seconds`, `width`, `height`, `metadata`, `channel.nickname` e `thumbnail_url`
- `GET` na `thumbnail_url` retornada responde `200` com `Content-Type: image/jpeg`
- `GET /videos/:slug` de um vídeo em `draft`, `processing` ou `failed` retorna `404` com `error: "VIDEO_NOT_FOUND"`
- `GET /videos/:slug` com slug inexistente retorna `404` com `error: "VIDEO_NOT_FOUND"`
- Dois vídeos enviados pelo mesmo usuário com o mesmo `file_name` recebem slugs diferentes e cada `GET /videos/:slug` retorna o seu próprio `id`

---

### SI-03.15 — Endpoint GET /videos/:slug/stream

**Route:** GET /videos/:slug/stream
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Anonymous

**Description:** Entrega o streaming redirecionando para uma URL pré-assinada de curta duração; o object storage atende requisições `Range` com `206 Partial Content`, então a reprodução começa sem baixar o arquivo inteiro (per `### API Contracts → GET /videos/:slug/stream`).

**Technical actions:**

1. Adicionar `VideosService.getStreamUrl(slug)` — reutiliza `findReadyBySlug` e retorna `presignGetObject(storage_key, { endpoint: 'public', expiresIn: video.playbackUrlExpirationSeconds })` (per `phase-03-videos/TD-11`)
2. Adicionar `@Public() @Get(':slug/stream')` em `VideosController` respondendo `302` com `Location` = URL retornada (`@Redirect()` dinâmico do Nest)
3. Documentar `@ApiResponse` `302` (header `Location`) e `404` (`VIDEO_NOT_FOUND`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` | Integration: `getStreamUrl` de um vídeo `ready` aponta para `storage_key` no host de `S3_PUBLIC_ENDPOINT`; vídeo não `ready` → `VIDEO_NOT_FOUND` | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.14 — `findReadyBySlug`

**Acceptance criteria:**

- `GET /videos/:slug/stream` sem token, para um vídeo `ready`, retorna `302` com `Location` apontando para o host de `S3_PUBLIC_ENDPOINT`
- `GET` na URL do `Location` com `Range: bytes=0-1023` retorna `206` com `Content-Range: bytes 0-1023/{file_size}`, `Content-Type` igual ao `mime_type` do vídeo e corpo de 1024 bytes
- `GET` na URL do `Location` com `Range` no meio do arquivo retorna `206` com exatamente o trecho pedido (o arquivo não é entregue inteiro)
- `GET /videos/:slug/stream` de um vídeo que não está `ready` retorna `404` com `error: "VIDEO_NOT_FOUND"`

---

### SI-03.16 — Endpoint GET /videos/:slug/download

**Route:** GET /videos/:slug/download
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Anonymous

**Description:** Permite ao usuário baixar o vídeo: redireciona para uma URL pré-assinada assinada com `Content-Disposition: attachment`, servida diretamente pelo storage (per `### API Contracts → GET /videos/:slug/download`; AMB-1 clarification).

**Technical actions:**

1. Adicionar `VideosService.getDownloadUrl(slug)` — reutiliza `findReadyBySlug` e retorna `presignGetObject(storage_key, { endpoint: 'public', expiresIn: video.playbackUrlExpirationSeconds, downloadFileName: original_filename })` (per `phase-03-videos/TD-11`)
2. Adicionar `@Public() @Get(':slug/download')` em `VideosController` respondendo `302` com `Location` = URL retornada
3. Documentar `@ApiResponse` `302` (header `Location`) e `404` (`VIDEO_NOT_FOUND`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` | Integration: `getDownloadUrl` assina `response-content-disposition` com o `original_filename`; vídeo não `ready` → `VIDEO_NOT_FOUND` | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.14 — `findReadyBySlug`

**Acceptance criteria:**

- `GET /videos/:slug/download` sem token, para um vídeo `ready`, retorna `302` com `Location` apontando para o host de `S3_PUBLIC_ENDPOINT`
- `GET` na URL do `Location` retorna `200` com `Content-Disposition: attachment; filename="{original_filename}"` e corpo com exatamente `file_size` bytes, idêntico ao arquivo enviado
- `GET /videos/:slug/download` de um vídeo que não está `ready` retorna `404` com `error: "VIDEO_NOT_FOUND"`

---

### SI-03.17 — Atualizar contrato OpenAPI e documentação de IA da fase

**Description:** Regera o `openapi.json` versionado com os endpoints de vídeo e atualiza a documentação usada pela IA (CLAUDE.md raiz e do backend, testing guide) para refletir o estado real do código ao fim da fase.

**Technical actions:**

1. Regerar `nestjs-project/openapi.json` via `npm run openapi:export` e incluir as requisições de vídeo em `nestjs-project/api.http` (per `openapi-docs-nestjs/TD-02`)
2. Atualizar `nestjs-project/CLAUDE.md` — seção de vídeos (módulos `videos`, `storage`, `queues`, `video-worker`; endpoints; ciclo de status; serviços `minio`, `minio-init`, `redis`, `video-worker` com verificações de prontidão; scripts do worker; prefixo de fila dos testes)
3. Atualizar o `CLAUDE.md` raiz — Message Queue deixa de ser `TBD` (BullMQ + Redis), storage MinIO, worker `video-worker` e link para a pasta da fase
4. Atualizar `.claude/skills/testing-guide-nestjs-project/references/external-systems.md` — Object Storage passa a ser MinIO real do Compose e Message Queue BullMQ/Redis com prefixo de teste (resolução de IC-1, per `phase-03-videos/TD-14`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `exportSpec` | Integration: documento exportado contém `/videos`, `/videos/{slug}/upload`, `/videos/{slug}/upload/complete`, `/videos/{slug}`, `/videos/{slug}/stream`, `/videos/{slug}/download` | `src/openapi-export.integration-spec.ts` |

**Dependencies:** SI-03.8, SI-03.9, SI-03.10, SI-03.13, SI-03.14, SI-03.15, SI-03.16 — todos os endpoints e o worker existem

**Acceptance criteria:**

- `nestjs-project/openapi.json` contém os 6 caminhos de vídeo com as respostas de erro referenciando `ApiErrorEnvelope`
- Endpoints públicos de vídeo não declaram `security` no `openapi.json`; endpoints autenticados declaram `access-token`
- Todo arquivo, comando e serviço citado na seção de vídeos dos `CLAUDE.md` existe no repositório / `compose.yaml`
- O `CLAUDE.md` raiz não descreve mais a fila como `TBD`

---

## Technical Specifications

### Data Model

#### Video

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK | Generated by the service (`crypto.randomUUID()`) before insert, because the storage key embeds it (per `phase-03-videos/TD-04`) |
| slug | varchar(11) | unique, not null | Public unique URL identifier — 11-char base64url from `node:crypto`, unique index, regenerated on unique violation (per `phase-03-videos/TD-10`) |
| channel_id | uuid | FK → channels.id, not null, `ON DELETE CASCADE` | Owner channel (1 user ↔ 1 channel from Fase 02) |
| title | varchar(100) | not null | Optional on upload start; defaults to the file name without extension (AMB-3 clarification) |
| status | enum `videos_status_enum` | not null, default `'draft'`, values: `'draft'`, `'processing'`, `'ready'`, `'failed'` | Lifecycle `draft → processing → ready \| failed` (per `phase-03-videos/TD-12`) |
| original_filename | varchar(255) | not null | Client-declared file name; used in the download `Content-Disposition` |
| mime_type | varchar(100) | not null | One of the allowlist in Validation Rules (per `phase-03-videos/TD-03`) |
| file_size | bigint | not null | Declared size in bytes, ≤ `VIDEO_MAX_FILE_SIZE_BYTES`; re-checked against `HeadObject` after completion (per `phase-03-videos/TD-03`). Mapped to `number` via column transformer (10 GiB < 2^53) |
| storage_key | varchar(255) | not null | `videos/{videoId}/source{.ext}` (per `phase-03-videos/TD-04`) |
| upload_id | varchar(255) | nullable | S3 multipart `UploadId` while `status = 'draft'`; set to `null` once the upload completes (per `phase-03-videos/TD-02`) |
| thumbnail_key | varchar(255) | nullable | `videos/{videoId}/thumbnail.jpg`, set by the worker (per `phase-03-videos/TD-04`, `phase-03-videos/TD-09`) |
| duration_seconds | double precision | nullable | From ffprobe `format.duration` (per `phase-03-videos/TD-07`) |
| width | integer | nullable | First video stream width |
| height | integer | nullable | First video stream height |
| metadata | jsonb | nullable | `{ formatName, bitRate, videoCodec, audioCodec, frameRate }` extracted by ffprobe |
| processing_error | text | nullable | Reason of the last failure when `status = 'failed'` (per `phase-03-videos/TD-12`) |
| processed_at | timestamp | nullable | Set when `status` becomes `'ready'` |
| created_at | timestamp | not null, auto-generated | `@CreateDateColumn` |
| updated_at | timestamp | not null, auto-generated | `@UpdateDateColumn` |

**Relations:** `Video` → `Channel` (many-to-one, owning side via `channel_id`); `Channel` → `Video` (one-to-many inverse side `videos`, no schema change on `channels`)
**Indexes:** `(slug)` — unique; `(channel_id)` — FK lookup

**Status transitions (each owned by exactly one component, per `phase-03-videos/TD-12`):**

| From | To | Owner | Trigger |
|------|----|-------|---------|
| — | `draft` | API (`VideosService`) | `POST /videos` (multipart upload created) |
| `draft` | `processing` | API (`VideosService`) | `POST /videos/:slug/upload/complete` succeeds and the job is enqueued |
| `draft` | `failed` | API (`VideosService`) | Completed object size differs from the declared `file_size`, or the job could not be enqueued |
| `processing` | `ready` | Worker (`VideoProcessingService`) | Metadata + thumbnail persisted |
| `processing` | `failed` | Worker (`VideoProcessingProcessor`) | Last attempt failed, or `UnrecoverableError` (unreadable media / no video stream) |

**Object storage layout** (single private bucket `S3_BUCKET`, per `phase-03-videos/TD-04`):

| Key | Written by | Content |
|-----|-----------|---------|
| `videos/{videoId}/source{.ext}` | Client (presigned multipart `UploadPart`) | Original video file (≤ 10 GiB) |
| `videos/{videoId}/thumbnail.jpg` | Worker (`PutObject`) | JPEG frame at 10% of the duration, max 1280px wide (per `phase-03-videos/TD-09`) |

Incomplete multipart uploads expire after 24h at the storage level (`MINIO_API_STALE_UPLOADS_EXPIRY=24h`; AWS `AbortIncompleteMultipartUpload` lifecycle rule in production) — no application cleanup (per `phase-03-videos/TD-15`).

### API Contracts

All bodies are JSON with snake_case fields (project convention from Fase 02: `access_token`, `new_password`). Errors use the inherited envelope `{ statusCode, error, message }` (per `phase-02-auth/TD-07`). Video bytes never flow through the API: uploads go to presigned part URLs and reads are `302` redirects to presigned GET URLs (per `phase-03-videos/TD-02`, `phase-03-videos/TD-11`).

#### POST /videos (SI-03.8)

Starts an upload: pre-registers the video as `draft` and opens an S3 multipart upload (per `phase-03-videos/TD-02`, `phase-03-videos/TD-12`).

**Request headers:**
- Authorization: Bearer {access_token}
- Content-Type: application/json

**Request body:**
- file_name: string, required — 1..255 characters
- file_size: integer, required — ≥ 1 byte; must be ≤ `VIDEO_MAX_FILE_SIZE_BYTES` (10737418240 by default) (per `phase-03-videos/TD-03`)
- mime_type: string, required — one of `video/mp4`, `video/webm`, `video/quicktime`, `video/x-matroska` (per `phase-03-videos/TD-03`)
- title: string, optional — 1..100 characters; defaults to `file_name` without its extension (AMB-3 clarification)

**Response 201:**
- id: string (uuid)
- slug: string (11 chars)
- title: string
- status: `"draft"`
- upload: object
  - part_size: integer — `VIDEO_UPLOAD_PART_SIZE_BYTES` (104857600 by default)
  - part_count: integer — `ceil(file_size / part_size)`
  - expires_at: string (ISO-8601) — expiry of the presigned part URLs (`VIDEO_UPLOAD_URL_EXPIRATION_SECONDS`, 3600 by default)
  - parts: array of `{ part_number: integer, url: string }` — one presigned `PUT` URL per part, host = `S3_PUBLIC_ENDPOINT` (per `phase-03-videos/TD-04`)

**Error responses:**
- 400 VALIDATION_ERROR: when the body fails validation (missing field, unknown field, MIME type outside the allowlist)
- 400 VIDEO_FILE_TOO_LARGE: when `file_size` exceeds `VIDEO_MAX_FILE_SIZE_BYTES`
- 401 (guard): when the access token is missing or invalid

**Client protocol after 201:** `PUT` part *n* (bytes `[(n-1)·part_size, n·part_size)`) to `parts[n-1].url`, keep each response `ETag` header, then call `POST /videos/:slug/upload/complete`.

---

#### GET /videos/:slug/upload (SI-03.9)

Owner-only view of the upload/processing pipeline; while `status = "draft"` it returns the already uploaded parts and fresh presigned URLs for the missing ones, enabling resume after a connection failure (per `phase-03-videos/TD-02`).

**Request headers:**
- Authorization: Bearer {access_token}

**Path parameters:**
- slug: string — the video slug

**Response 200:**
- id: string (uuid)
- slug: string
- status: `"draft"` | `"processing"` | `"ready"` | `"failed"`
- processing_error: string | null
- upload: object | null — present only when `status = "draft"`:
  - part_size: integer
  - part_count: integer
  - expires_at: string (ISO-8601)
  - uploaded_parts: array of `{ part_number: integer, etag: string, size: integer }` (from `ListParts`)
  - parts: array of `{ part_number: integer, url: string }` — presigned URLs only for parts not yet uploaded

**Error responses:**
- 401 (guard): when the access token is missing or invalid
- 404 VIDEO_NOT_FOUND: when the slug does not exist or the video belongs to another user's channel (no ownership leak)
- 410 UPLOAD_EXPIRED: when `status = "draft"` but the multipart upload no longer exists in storage (expired after 24h, per `phase-03-videos/TD-15`)

---

#### POST /videos/:slug/upload/complete (SI-03.10)

Completes the multipart upload, validates the stored size, moves the video to `processing` and enqueues the processing job (per `phase-03-videos/TD-02`, `phase-03-videos/TD-12`, `phase-03-videos/TD-13`).

**Request headers:**
- Authorization: Bearer {access_token}
- Content-Type: application/json

**Path parameters:**
- slug: string — the video slug

**Request body:**
- parts: array, required — 1..10000 items, each:
  - part_number: integer, required — 1..10000
  - etag: string, required — the `ETag` header returned by the part `PUT`

**Response 200:**
- id: string (uuid)
- slug: string
- title: string
- status: `"processing"`

**Error responses:**
- 400 VALIDATION_ERROR: when the body fails validation
- 400 INVALID_UPLOAD_PARTS: when storage rejects the part list (unknown part/ETag, wrong order, part smaller than 5 MiB except the last)
- 400 UPLOAD_SIZE_MISMATCH: when the completed object's size differs from the declared `file_size` (object deleted, video marked `failed`)
- 401 (guard): when the access token is missing or invalid
- 404 VIDEO_NOT_FOUND: when the slug does not exist or belongs to another user's channel
- 409 VIDEO_NOT_IN_DRAFT: when the video is not in `draft` (upload already completed)
- 410 UPLOAD_EXPIRED: when the multipart upload no longer exists in storage

---

#### GET /videos/:slug (SI-03.14)

Public metadata of a `ready` video addressed by its unique URL (AMB-2 clarification).

**Path parameters:**
- slug: string — the video slug

**Response 200:**
- id: string (uuid)
- slug: string
- title: string
- status: `"ready"`
- duration_seconds: number
- width: integer
- height: integer
- mime_type: string
- file_size: integer
- metadata: object — `{ format_name, bit_rate, video_codec, audio_codec, frame_rate }` (fields nullable when absent from the media)
- thumbnail_url: string — presigned GET URL of `videos/{videoId}/thumbnail.jpg`
- channel: object — `{ id: string (uuid), nickname: string, name: string }`
- created_at: string (ISO-8601)
- processed_at: string (ISO-8601)

**Error responses:**
- 404 VIDEO_NOT_FOUND: when the slug does not exist or the video is not `ready`

---

#### GET /videos/:slug/stream (SI-03.15)

Streaming entry point: redirects to a short-lived presigned GET URL; the object storage answers `Range` requests with `206 Partial Content`, so playback starts without a full download (per `phase-03-videos/TD-11`).

**Path parameters:**
- slug: string — the video slug

**Response 302:**
- Location: presigned GET URL of `storage_key` (expires after `VIDEO_PLAYBACK_URL_EXPIRATION_SECONDS`, 14400 by default), host = `S3_PUBLIC_ENDPOINT`
- Follow-up `GET Location` with `Range: bytes=a-b` → `206 Partial Content`, `Content-Range: bytes a-b/{file_size}`, `Content-Type: {mime_type}`

**Error responses:**
- 404 VIDEO_NOT_FOUND: when the slug does not exist or the video is not `ready`

---

#### GET /videos/:slug/download (SI-03.16)

Download entry point: same redirect, signed with `ResponseContentDisposition` so the storage answers with `Content-Disposition: attachment; filename="{original_filename}"` (per `phase-03-videos/TD-11`; AMB-1 clarification — public, `ready` only).

**Path parameters:**
- slug: string — the video slug

**Response 302:**
- Location: presigned GET URL of `storage_key` with `ResponseContentDisposition: attachment; filename="{original_filename}"`
- Follow-up `GET Location` → `200` with `Content-Disposition: attachment; filename="{original_filename}"` and the full file body

**Error responses:**
- 404 VIDEO_NOT_FOUND: when the slug does not exist or the video is not `ready`

---

#### Validation Rules — Videos

| Field | Rule | Message |
|-------|------|---------|
| file_name | required string, 1..255 chars | file_name must be shorter than or equal to 255 characters |
| file_size | required integer, min 1 (max enforced by the service from `VIDEO_MAX_FILE_SIZE_BYTES` → `VIDEO_FILE_TOO_LARGE`) | file_size must not be less than 1 |
| mime_type | required, one of `video/mp4`, `video/webm`, `video/quicktime`, `video/x-matroska` | mime_type must be one of the following values: … |
| title | optional string, 1..100 chars | title must be shorter than or equal to 100 characters |
| parts | required array, 1..10000 items, nested validation | parts must contain at least 1 elements |
| parts[].part_number | required integer, 1..10000 | part_number must not be greater than 10000 |
| parts[].etag | required non-empty string | etag should not be empty |

### Authorization Matrix

The global `JwtAuthGuard` (`APP_GUARD`, Fase 02) protects every route by default; public routes opt out with `@Public()`. "Owner" = the authenticated user whose channel (`channels.user_id = sub`) owns the video; a non-owner receives `404 VIDEO_NOT_FOUND`, never `403`, so the existence of another user's draft is not revealed (AMB-2 clarification).

| Endpoint | Anonymous | Authenticated | Owner | Notes |
|----------|-----------|---------------|-------|-------|
| POST /videos | ✗ | ✓ | — | The video is created in the caller's own channel |
| GET /videos/:slug/upload | ✗ | ✗ | ✓ | Any status; resume data only while `draft` |
| POST /videos/:slug/upload/complete | ✗ | ✗ | ✓ | Only while `draft` |
| GET /videos/:slug | ✓ | ✓ | ✓ | `@Public()`; only `ready` videos |
| GET /videos/:slug/stream | ✓ | ✓ | ✓ | `@Public()`; only `ready` videos |
| GET /videos/:slug/download | ✓ | ✓ | ✓ | `@Public()`; only `ready` videos (AMB-1 clarification) |

Presigned URLs are the only grant to the private bucket (per `phase-03-videos/TD-04`): part `PUT` URLs are handed only to the owner; GET URLs only for `ready` videos.

### Error Catalog

**Error response format:** inherited from Fase 02 — `{ statusCode: number, error: string, message: string }` with the domain code in `error` (per `phase-02-auth/TD-07`). New domain exceptions extend `DomainException` in `src/common/exceptions/domain.exception.ts`.

| Code | HTTP | Message | Trigger |
|------|------|---------|---------|
| VIDEO_FILE_TOO_LARGE | 400 | Video file exceeds the maximum allowed size | `POST /videos` with `file_size` > `VIDEO_MAX_FILE_SIZE_BYTES` |
| VIDEO_NOT_FOUND | 404 | Video not found | Unknown slug; owner endpoints called by a non-owner; public endpoints for a video that is not `ready` |
| VIDEO_NOT_IN_DRAFT | 409 | Video upload is not in progress | `POST /videos/:slug/upload/complete` when `status != 'draft'` |
| UPLOAD_EXPIRED | 410 | Upload session has expired | Storage returns `NoSuchUpload` for the stored `upload_id` (stale upload aborted after 24h, per `phase-03-videos/TD-15`) |
| INVALID_UPLOAD_PARTS | 400 | Uploaded parts are invalid | Storage rejects `CompleteMultipartUpload` (`InvalidPart`, `InvalidPartOrder`, `EntityTooSmall`) |
| UPLOAD_SIZE_MISMATCH | 400 | Uploaded file size does not match the declared size | `HeadObject.ContentLength` ≠ declared `file_size` after completion |
| VALIDATION_ERROR | 400 | _(array of field errors)_ | Inherited — `ValidationExceptionFilter` |

Worker-side failures are not HTTP errors: they are persisted in `videos.processing_error` with `status = 'failed'` (per `phase-03-videos/TD-12`).

### Events/Messages

#### video-processing / process-video

**Queue:** `video-processing` (BullMQ on Redis, per `phase-03-videos/TD-01`)
**Job name:** `process-video`

**Payload:**

```json
{ "videoId": "uuid" }
```

**Job options:** `jobId = videoId` (duplicate enqueues are ignored), `attempts: 3`, `backoff: { type: 'exponential', delay: 5000 }`, `removeOnComplete: true`, `removeOnFail: false` (per `phase-03-videos/TD-12`, `phase-03-videos/TD-13`)
**Producer:** `VideoProcessingProducer` called by `VideosService.completeUpload` after the video is set to `processing` (per `phase-03-videos/TD-13`)
**Consumer:** `VideoProcessingProcessor` (`@Processor('video-processing')`, `WorkerHost`) registered only in the `video-worker` process (`src/worker.ts`), never in the API process (per `phase-03-videos/TD-06`)
**Trigger:** successful `POST /videos/:slug/upload/complete`
**Delivery semantics:** at-least-once; idempotent consumer — the worker re-reads the video and processes it only while `status = 'processing'`, and its outputs are deterministic (same `thumbnail_key`, same columns) so a retried or duplicated job converges to the same state (per `phase-03-videos/TD-13`)

**Processing steps (consumer):**

1. Load the video by `videoId`; if missing or `status != 'processing'`, finish without changes.
2. Presign an internal GET URL (endpoint `S3_ENDPOINT`) and run `ffprobe -v error -print_format json -show_format -show_streams <url>` (per `phase-03-videos/TD-07`, `phase-03-videos/TD-08`).
3. No video stream or unreadable media → throw `UnrecoverableError` (no retry).
4. `ffmpeg -ss <duration*0.1> -i <url> -frames:v 1 -vf "scale='min(1280,iw)':-2" -q:v 3 <tmp>.jpg` → `PutObject videos/{videoId}/thumbnail.jpg` (per `phase-03-videos/TD-09`).
5. Persist `duration_seconds`, `width`, `height`, `metadata`, `thumbnail_key`, `processed_at`, `status = 'ready'`, `processing_error = null`.

**Failure event:** on the worker `failed` event, when the error is an `UnrecoverableError` or `job.attemptsMade >= job.opts.attempts`, the video is set to `status = 'failed'` with `processing_error = error.message`; earlier failed attempts leave the status `processing` while BullMQ retries.

---

## Dependency Map

```
SI-03.1 (root — deps + config namespaces)
├── SI-03.2 — depends on SI-03.1 (Compose interpolates S3_* from .env)
│   ├── SI-03.3 — depends on SI-03.1 + SI-03.2 (SDK + MinIO/bucket)
│   │   └── SI-03.11 — depends on SI-03.2 + SI-03.3 (FFmpeg in image + presigned HTTP input)
│   └── SI-03.6 — depends on SI-03.1 + SI-03.2 (queueConfig + Redis)
SI-03.4 (root — Video entity + migration)

SI-03.3 + SI-03.4
└── SI-03.5 — initiateUpload (draft pre-registration)
    └── SI-03.8 — POST /videos

SI-03.5 + SI-03.6
└── SI-03.7 — getUploadStatus + completeUpload (draft → processing + enqueue)
    ├── SI-03.9 — GET /videos/:slug/upload (+ SI-03.8 controller)
    └── SI-03.10 — POST /videos/:slug/upload/complete (+ SI-03.8 controller)

SI-03.7 + SI-03.11
└── SI-03.12 — worker processing (processing → ready | failed)
    ├── SI-03.13 — worker entrypoint + video-worker Compose service
    └── SI-03.14 — GET /videos/:slug (+ SI-03.8 controller)
        ├── SI-03.15 — GET /videos/:slug/stream
        └── SI-03.16 — GET /videos/:slug/download

SI-03.8 + SI-03.9 + SI-03.10 + SI-03.13 + SI-03.14 + SI-03.15 + SI-03.16
└── SI-03.17 — OpenAPI export + CLAUDE.md / testing guide docs
```

Linearized implementation order: SI-03.1 → SI-03.2 → SI-03.3, SI-03.4, SI-03.6 (parallel) → SI-03.5 → SI-03.7, SI-03.8, SI-03.11 (parallel) → SI-03.9, SI-03.10, SI-03.12 (parallel) → SI-03.13, SI-03.14 (parallel) → SI-03.15, SI-03.16 (parallel) → SI-03.17

---

## Deliverables

- [ ] SI-03.1 — Instalar dependências e namespaces de configuração da fase
- [ ] SI-03.2 — Infra: subir MinIO, Redis e FFmpeg no Docker Compose
- [ ] SI-03.3 — Criar StorageModule para multipart, URLs pré-assinadas e objetos
- [ ] SI-03.4 — Criar entidade Video, VideosModule e migration CreateVideos
- [ ] SI-03.5 — Pré-cadastrar vídeo como rascunho ao iniciar o upload
- [ ] SI-03.6 — Configurar a fila video-processing e o produtor de jobs
- [ ] SI-03.7 — Retomar e concluir o upload, disparando o processamento
- [ ] SI-03.8 — Endpoint POST /videos
- [ ] SI-03.9 — Endpoint GET /videos/:slug/upload
- [ ] SI-03.10 — Endpoint POST /videos/:slug/upload/complete
- [ ] SI-03.11 — Extrair metadados e thumbnail com ffprobe/ffmpeg
- [ ] SI-03.12 — Processar o vídeo no worker e fechar o ciclo de status
- [ ] SI-03.13 — Subir o worker de vídeo como processo e serviço Compose próprios
- [ ] SI-03.14 — Endpoint GET /videos/:slug
- [ ] SI-03.15 — Endpoint GET /videos/:slug/stream
- [ ] SI-03.16 — Endpoint GET /videos/:slug/download
- [ ] SI-03.17 — Atualizar contrato OpenAPI e documentação de IA da fase

**Full test suites:**

- [ ] Backend tests pass (`cd nestjs-project && docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`cd nestjs-project && docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type/compilation checks pass (`cd nestjs-project && docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes (`cd nestjs-project && docker compose exec nestjs-api npm run lint`)
- [ ] Project builds successfully (`cd nestjs-project && docker compose exec nestjs-api npm run build`)
