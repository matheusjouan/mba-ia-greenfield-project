---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.9
target_file: test/videos-upload-status.e2e-spec.ts
---

# GET /videos/:slug/upload — Test Plan

## Application Overview

`GET /videos/:slug/upload` é a visão do dono sobre o pipeline do vídeo. Enquanto o vídeo está em `draft`, consulta o multipart no storage (`ListParts`) e devolve as partes já enviadas e novas URLs pré-assinadas apenas para as partes faltantes — é o mecanismo de retomada após falha de conexão. Fora de `draft`, devolve só o status (`processing`/`ready`/`failed`) e `processing_error`. Quem não é dono recebe `404 VIDEO_NOT_FOUND`, sem revelar a existência do vídeo.

## Test Scenarios

### 1. Retomada do upload pelo dono

**Setup:** `beforeEach` limpa as tabelas; app bootstrapado com `AppModule` e a config global de `main.ts`, com `VIDEO_UPLOAD_PART_SIZE_BYTES=5242880` definido antes do bootstrap (permite um upload de 2 partes com 6 MiB); usuário dono registrado, confirmado e logado.

#### 1.1. lista-partes-enviadas-e-urls-das-faltantes

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. POST /videos com `file_size: 6291456`, `mime_type: "video/mp4"`
    - expect: status `201` com `upload.part_count = 2`
  2. PUT de 5242880 bytes na URL da parte 1
    - expect: status `200` com `ETag`
  3. GET /videos/{slug}/upload com o token do dono
    - expect: status `200` com `status: "draft"` e `processing_error: null`
    - expect: `upload.uploaded_parts` contém exatamente `{ part_number: 1, etag: <ETag do passo 2>, size: 5242880 }`
    - expect: `upload.parts` contém só `part_number: 2` com uma `url`

#### 1.2. video-em-processing-nao-retorna-dados-de-upload

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. Iniciar um upload de 1 parte, enviar a parte e chamar POST /videos/{slug}/upload/complete com o `ETag`
    - expect: status `200` com `status: "processing"`
  2. GET /videos/{slug}/upload com o token do dono
    - expect: status `200` com `status: "processing"` e `upload: null`

### 2. Acesso negado e recurso inexistente

**Setup:** igual ao grupo 1, com um segundo usuário registrado, confirmado e logado.

#### 2.1. outro-usuario-recebe-404

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. Dono inicia um upload (POST /videos)
    - expect: status `201`
  2. GET /videos/{slug}/upload com o token do segundo usuário
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`

#### 2.2. sem-token-retorna-401

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. GET /videos/{slug}/upload sem `Authorization` para um vídeo existente
    - expect: status `401`

#### 2.3. slug-inexistente-retorna-404

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. GET /videos/AAAAAAAAAAA/upload com token válido
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`
