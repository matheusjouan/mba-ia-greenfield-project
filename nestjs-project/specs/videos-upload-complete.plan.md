---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.10
target_file: test/videos-upload-complete.e2e-spec.ts
---

# POST /videos/:slug/upload/complete — Test Plan

## Application Overview

`POST /videos/:slug/upload/complete` fecha o multipart upload no storage com a lista `{ part_number, etag }` enviada pelo dono, confere o tamanho armazenado contra o `file_size` declarado, move o vídeo de `draft` para `processing` e publica o job `process-video` (`{ videoId }`, `jobId = videoId`) na fila `video-processing` — é o gatilho do processamento automático.

## Test Scenarios

### 1. Conclusão do upload e disparo do processamento

**Setup:** `beforeEach` limpa as tabelas e esvazia a fila `video-processing` (prefixo de teste `QUEUE_PREFIX`); app bootstrapado com `AppModule` e a config global de `main.ts`; usuário dono registrado, confirmado e logado; vídeo iniciado via POST /videos com 1 parte enviada por PUT na URL pré-assinada.

#### 1.1. conclui-upload-e-move-para-processing

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. POST /videos/{slug}/upload/complete com o token do dono e `{ parts: [{ part_number: 1, etag: <ETag do PUT> }] }`
    - expect: status `200` com `id`, `slug`, `title` e `status: "processing"`
  2. Consultar a linha em `videos`
    - expect: `status = 'processing'` e `upload_id = null`
  3. Consultar a fila `video-processing` (via `getQueueToken`)
    - expect: existe um job `process-video` com `id = <video id>` e `data = { videoId: <video id> }`

#### 1.2. segunda-conclusao-retorna-409

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. Concluir o upload com sucesso (como em 1.1)
    - expect: status `200`
  2. Repetir POST /videos/{slug}/upload/complete com o mesmo body
    - expect: status `409` com `error: "VIDEO_NOT_IN_DRAFT"`

### 2. Rejeições

**Setup:** igual ao grupo 1, com um segundo usuário registrado, confirmado e logado.

#### 2.1. etag-invalido-retorna-400-invalid-upload-parts

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. POST /videos/{slug}/upload/complete com `{ parts: [{ part_number: 1, etag: "\"00000000000000000000000000000000\"" }] }`
    - expect: status `400` com `error: "INVALID_UPLOAD_PARTS"`
    - expect: o vídeo continua em `draft`

#### 2.2. lista-de-partes-vazia-retorna-400

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. POST /videos/{slug}/upload/complete com `{ parts: [] }`
    - expect: status `400` com `error: "VALIDATION_ERROR"`

#### 2.3. outro-usuario-recebe-404

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. POST /videos/{slug}/upload/complete com o token do segundo usuário e as partes corretas
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`
    - expect: o vídeo continua em `draft`
