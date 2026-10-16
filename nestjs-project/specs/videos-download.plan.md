---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.16
target_file: test/videos-download.e2e-spec.ts
---

# GET /videos/:slug/download — Test Plan

## Application Overview

`GET /videos/:slug/download` permite baixar o vídeo: para um vídeo `ready`, responde `302` com `Location` para uma URL pré-assinada assinada com `ResponseContentDisposition: attachment; filename="{original_filename}"`, então o próprio storage entrega o arquivo completo com o header de download. Público (anônimo incluso), apenas para vídeos `ready`.

## Test Scenarios

### 1. Download do arquivo original

**Setup:** `beforeEach` limpa as tabelas; app bootstrapado com `AppModule` + config global de `main.ts` e o contexto `WorkerModule` in-process (prefixo de fila de teste); usuário dono logado; `test/fixtures/sample.mp4` enviado com `file_name: "sample.mp4"` e processado até `ready` (timeout 60 s).

#### 1.1. redireciona-para-url-de-download

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. GET /videos/{slug}/download sem `Authorization` (supertest sem seguir redirects)
    - expect: status `302`
    - expect: header `Location` com host igual ao de `S3_PUBLIC_ENDPOINT`

#### 1.2. storage-entrega-arquivo-completo-como-anexo

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. GET na URL do `Location`
    - expect: status `200`
    - expect: `Content-Disposition: attachment; filename="sample.mp4"`
    - expect: corpo com exatamente `file_size` bytes e idêntico byte a byte ao fixture enviado

### 2. Vídeo indisponível

**Setup:** igual ao grupo 1, sem processamento.

#### 2.1. video-nao-pronto-retorna-404

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. Iniciar um upload (POST /videos) sem concluí-lo — vídeo em `draft`
  2. GET /videos/{slug}/download sem token
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`
