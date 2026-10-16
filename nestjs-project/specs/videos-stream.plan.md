---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.15
target_file: test/videos-stream.e2e-spec.ts
---

# GET /videos/:slug/stream — Test Plan

## Application Overview

`GET /videos/:slug/stream` é o ponto de entrada do streaming: para um vídeo `ready`, responde `302` com `Location` para uma URL pré-assinada de curta duração do objeto original. O object storage atende requisições HTTP `Range` com `206 Partial Content`, então o player começa a reproduzir sem baixar o arquivo inteiro e pode buscar qualquer trecho. Os bytes nunca passam pela API.

## Test Scenarios

### 1. Streaming por requisições parciais

**Setup:** `beforeEach` limpa as tabelas; app bootstrapado com `AppModule` + config global de `main.ts` e o contexto `WorkerModule` in-process (prefixo de fila de teste); usuário dono logado; `test/fixtures/sample.mp4` enviado e processado até `ready` (timeout 60 s).

#### 1.1. redireciona-para-url-pre-assinada

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. GET /videos/{slug}/stream sem `Authorization` (supertest sem seguir redirects)
    - expect: status `302`
    - expect: header `Location` com host igual ao de `S3_PUBLIC_ENDPOINT` e caminho contendo `videos/{id}/source.mp4`

#### 1.2. range-inicial-retorna-206

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. GET na URL do `Location` com `Range: bytes=0-1023`
    - expect: status `206`
    - expect: `Content-Range: bytes 0-1023/{file_size}` e `Content-Type: video/mp4`
    - expect: corpo com exatamente 1024 bytes, iguais aos primeiros 1024 bytes do fixture

#### 1.3. range-no-meio-do-arquivo-retorna-somente-o-trecho

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. GET na URL do `Location` com `Range: bytes=2048-4095`
    - expect: status `206` com `Content-Range: bytes 2048-4095/{file_size}`
    - expect: corpo com 2048 bytes iguais ao trecho correspondente do fixture (o arquivo não é entregue inteiro)

### 2. Vídeo indisponível

**Setup:** igual ao grupo 1, sem processamento.

#### 2.1. video-nao-pronto-retorna-404

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. Iniciar um upload (POST /videos) sem concluí-lo — vídeo em `draft`
  2. GET /videos/{slug}/stream sem token
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`
