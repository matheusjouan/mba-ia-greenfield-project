---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.14
target_file: test/videos-get.e2e-spec.ts
---

# GET /videos/:slug — Test Plan

## Application Overview

`GET /videos/:slug` é a URL única pública do vídeo: qualquer pessoa (sem token) obtém os metadados de um vídeo `ready` — duração, dimensões, metadados extraídos pelo ffprobe, canal dono e `thumbnail_url` pré-assinada do thumbnail gerado pelo worker. Vídeos que não estão `ready` respondem `404 VIDEO_NOT_FOUND`. Este spec exercita o pipeline completo: upload direto ao MinIO → conclusão → job na fila Redis → worker com FFmpeg → `ready`.

## Test Scenarios

### 1. Vídeo pronto acessível pela URL única

**Setup:** `beforeEach` limpa as tabelas; app bootstrapado com `AppModule` + config global de `main.ts` e, no mesmo processo, o contexto `WorkerModule` (worker in-process consumindo a fila sob o prefixo de teste); usuário dono registrado, confirmado e logado; helper que envia `test/fixtures/sample.mp4` (POST /videos → PUT na URL da parte → POST complete) e aguarda o vídeo chegar a `ready` consultando o banco (timeout 60 s).

#### 1.1. retorna-metadados-do-video-pronto-sem-token

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. Enviar o fixture e aguardar `status = 'ready'`
    - expect: o vídeo chega a `ready` dentro do timeout
  2. GET /videos/{slug} sem `Authorization`
    - expect: status `200` com `status: "ready"`
    - expect: `duration_seconds` entre `2.9` e `3.1`, `width: 320`, `height: 240`, `mime_type: "video/mp4"`
    - expect: `metadata.video_codec: "h264"` e `channel.nickname` igual ao nickname do dono
    - expect: `thumbnail_url` é uma URL http(s)

#### 1.2. thumbnail-url-entrega-jpeg

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. GET /videos/{slug} de um vídeo `ready`
    - expect: status `200`
  2. GET na `thumbnail_url` retornada (fetch direto ao storage)
    - expect: status `200` com `Content-Type: image/jpeg`
    - expect: corpo começa com os bytes `FF D8 FF`

#### 1.3. uploads-com-mesmo-nome-recebem-urls-distintas

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. Enviar o fixture duas vezes com o mesmo `file_name: "sample.mp4"` e aguardar ambos `ready`
    - expect: os dois `slug`s são diferentes
  2. GET /videos/{slugA} e GET /videos/{slugB}
    - expect: cada resposta `200` traz o `id` do seu próprio vídeo

### 2. Vídeos não prontos e slugs inexistentes

**Setup:** igual ao grupo 1 (sem aguardar processamento quando indicado).

#### 2.1. video-nao-pronto-retorna-404

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. Iniciar um upload (POST /videos) sem concluí-lo — vídeo em `draft`
    - expect: GET /videos/{slug} retorna `404` com `error: "VIDEO_NOT_FOUND"`
  2. Forçar no banco `status = 'processing'` e depois `status = 'failed'` para esse vídeo
    - expect: em ambos os casos GET /videos/{slug} retorna `404` com `error: "VIDEO_NOT_FOUND"`

#### 2.2. slug-inexistente-retorna-404

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-16T20:01:58Z

**Steps:**
  1. GET /videos/AAAAAAAAAAA sem token
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`
