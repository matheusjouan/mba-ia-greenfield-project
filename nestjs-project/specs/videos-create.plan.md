---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.8
target_file: test/videos-create.e2e-spec.ts
---

# POST /videos — Test Plan

## Application Overview

`POST /videos` inicia o upload de um vídeo de até 10GB sem que o arquivo passe pela API: o endpoint autenticado valida o payload (`file_name`, `file_size`, `mime_type`, `title?`), pré-cadastra o vídeo como `draft` no canal do usuário, abre um multipart upload no MinIO e devolve uma URL pré-assinada de `PUT` por parte. O cliente envia os bytes direto ao storage. Erros seguem o envelope `{ statusCode, error, message }`.

## Test Scenarios

### 1. Iniciar upload com pré-cadastro do rascunho

**Setup:** `beforeEach` limpa as tabelas (`cleanAllTables`, incluindo `videos`); app Nest bootstrapado via `Test.createTestingModule({ imports: [AppModule] })` com `ValidationPipe` + filtros globais de `main.ts`; usuário registrado, confirmado e logado para obter `access_token`.

#### 1.1. cria-rascunho-e-retorna-urls-das-partes

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. POST /videos com `Authorization: Bearer {access_token}` e body `{ file_name: "clip.mp4", file_size: 1048576, mime_type: "video/mp4" }`
    - expect: status `201`
    - expect: body contém `id` (uuid), `slug` com 11 caracteres base64url, `title: "clip"` e `status: "draft"`
    - expect: `upload.part_size = 104857600`, `upload.part_count = 1`, `upload.expires_at` é uma data ISO futura
    - expect: `upload.parts` tem 1 item com `part_number: 1` e `url` http(s)
  2. Consultar a tabela `videos` pelo `id` retornado
    - expect: linha com `status = 'draft'`, `upload_id` não nulo e `storage_key = videos/{id}/source.mp4`, vinculada ao canal do usuário

#### 1.2. url-da-parte-aceita-put-direto-no-storage

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. POST /videos com token válido para um arquivo de 1048576 bytes
    - expect: status `201`
  2. PUT de 1048576 bytes na `upload.parts[0].url` retornada (fetch direto ao storage, sem passar pela API)
    - expect: status `200`
    - expect: header `ETag` presente

### 2. Rejeições de entrada e autenticação

**Setup:** igual ao grupo 1.

#### 2.1. sem-token-retorna-401

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. POST /videos sem header `Authorization` e body válido
    - expect: status `401`
    - expect: nenhuma linha criada em `videos`

#### 2.2. mime-type-fora-da-allowlist-retorna-400

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. POST /videos com token válido e `mime_type: "image/png"`
    - expect: status `400`
    - expect: `error: "VALIDATION_ERROR"` e `message` é um array mencionando `mime_type`

#### 2.3. arquivo-acima-de-10gb-retorna-400

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. POST /videos com token válido e `file_size: 10737418241`
    - expect: status `400`
    - expect: `error: "VIDEO_FILE_TOO_LARGE"`
    - expect: nenhuma linha criada em `videos`

#### 2.4. campo-desconhecido-retorna-400

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. POST /videos com token válido, body válido e campo extra `status: "ready"`
    - expect: status `400`
    - expect: `error: "VALIDATION_ERROR"`
