---
kind: phase
name: phase-03-videos
status: clean
issue_count: 0
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-16T16:40:16-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-16T16:38:04-03:00"
issues:
  - id: IC-1
    status: resolved
    summary: "Testing guide prescribes local-filesystem storage in tests; TD-02/TD-14 need real S3"
    resolved_by: phase-03-videos/TD-14
  - id: AMB-1
    status: resolved
    summary: "Download: anonymous or authenticated user? Only for ready videos?"
    resolved_by: clarification
  - id: AMB-2
    status: resolved
    summary: "Public access to a ready video before Fase 04 publication flow exists"
    resolved_by: clarification
  - id: AMB-3
    status: resolved
    summary: "Pre-registration input: which fields the draft requires at upload start"
    resolved_by: clarification
  - id: MD-1
    status: resolved
    summary: "No TD for abandoned multipart uploads cleanup (storage cost)"
    resolved_by: phase-03-videos/TD-15
  - id: DG-1
    status: resolved
    summary: "Phase 02 .env.example MAIL_FROM unquoted breaks docker compose up"
    resolved_by: clarification
  - id: OQ-1
    status: resolved
    summary: "TD-01 pending — Message Queue Technology"
    resolved_by: phase-03-videos/TD-01
  - id: OQ-2
    status: resolved
    summary: "TD-02 pending — Large File Upload Strategy"
    resolved_by: phase-03-videos/TD-02
  - id: OQ-3
    status: resolved
    summary: "TD-03 pending — Upload Limits and Part Sizing Policy"
    resolved_by: phase-03-videos/TD-03
  - id: OQ-4
    status: resolved
    summary: "TD-04 pending — Object Storage Layout, Provisioning and Presigned Endpoint"
    resolved_by: phase-03-videos/TD-04
  - id: OQ-5
    status: resolved
    summary: "TD-05 pending — Object Storage Container Image"
    resolved_by: phase-03-videos/TD-05
  - id: OQ-6
    status: resolved
    summary: "TD-06 pending — Video Worker Runtime and Deployment"
    resolved_by: phase-03-videos/TD-06
  - id: OQ-7
    status: resolved
    summary: "TD-07 pending — FFmpeg Integration Approach"
    resolved_by: phase-03-videos/TD-07
  - id: OQ-8
    status: resolved
    summary: "TD-08 pending — Worker Media Access Strategy"
    resolved_by: phase-03-videos/TD-08
  - id: OQ-9
    status: resolved
    summary: "TD-09 pending — Thumbnail Generation Policy"
    resolved_by: phase-03-videos/TD-09
  - id: OQ-10
    status: resolved
    summary: "TD-10 pending — Unique Video URL Identifier"
    resolved_by: phase-03-videos/TD-10
  - id: OQ-11
    status: resolved
    summary: "TD-11 pending — Streaming and Download Delivery"
    resolved_by: phase-03-videos/TD-11
  - id: OQ-12
    status: resolved
    summary: "TD-12 pending — Video Status Lifecycle and Failure Handling"
    resolved_by: phase-03-videos/TD-12
  - id: OQ-13
    status: resolved
    summary: "TD-13 pending — Processing Job Contract and Idempotency"
    resolved_by: phase-03-videos/TD-13
  - id: OQ-14
    status: resolved
    summary: "TD-14 pending — Testing Strategy for Storage, Queue and Worker"
    resolved_by: phase-03-videos/TD-14
  - id: OQ-15
    status: resolved
    summary: "TD-15 pending — Abandoned Multipart Upload Cleanup"
    resolved_by: phase-03-videos/TD-15
advisories: []
---

# phase-03-videos — Validation

## Findings

### Inconsistencies

_None._

### Ambiguities

_None._

### Missing Decisions

_None._

### Dependency Gaps

_None._

### Inherited Constraint Conflicts

_None._

### Unresolved Open Questions

_None._

### UI Coverage Gaps

_None._

## Resolved Issues

- **MD-1** _(resolved_by phase-03-videos/TD-15)_ — No TD for abandoned multipart uploads cleanup (storage cost). TD-15 added via a `/research` cycle and re-aggregated by `/plan-context`.
- **IC-1** _(resolved_by phase-03-videos/TD-14)_ — Testing guide prescribes local-filesystem storage in tests; TD-02/TD-14 need real S3. User chose real MinIO from Compose in integration/e2e tests (TD-14 A). The guide's "Object Storage — Local Filesystem" strategy predates the storage decision and is superseded for S3-compatible storage; the guide's `references/external-systems.md` must be updated to reflect it when the phase is implemented.
- **AMB-1** _(resolved_by clarification)_ — Download is public (anonymous allowed), same access as streaming, and only for videos with status `ready`.
- **AMB-2** _(resolved_by clarification)_ — Phase 03 read rule: anyone holding the unique URL (slug) may read metadata, stream and download a `ready` video; videos in `draft`/`processing`/`failed` are visible only to their owner through authenticated endpoints. Editorial publication/visibility stays in Fase 04.
- **AMB-3** _(resolved_by clarification)_ — Upload initiation requires `fileName`, `fileSize`, `mimeType`; `title` is optional and defaults to the file name without its extension. Full metadata editing stays in Fase 04.
- **DG-1** _(resolved_by clarification)_ — Fix the Phase 02 `.env.example` `MAIL_FROM` quoting in a dedicated `bugfix/*` branch from `dev` (outside this phase's scope, per CLAUDE.md scope limits); Phase 03 work proceeds on top of the fixed `dev`.
- **OQ-1** _(resolved_by phase-03-videos/TD-01)_ — TD-01 decided: A (BullMQ + Redis).
- **OQ-2** _(resolved_by phase-03-videos/TD-02)_ — TD-02 decided: A (S3 Multipart Upload with presigned part URLs).
- **OQ-3** _(resolved_by phase-03-videos/TD-03)_ — TD-03 decided: A (fixed 100 MiB parts, 10 GiB max, MIME allowlist).
- **OQ-4** _(resolved_by phase-03-videos/TD-04)_ — TD-04 decided: A (single private bucket, per-video prefix, minio-init, dual endpoint).
- **OQ-5** _(resolved_by phase-03-videos/TD-05)_ — TD-05 decided: A (Chainguard MinIO pinned by digest).
- **OQ-6** _(resolved_by phase-03-videos/TD-06)_ — TD-06 decided: A (same codebase, separate entrypoint and Compose service).
- **OQ-7** _(resolved_by phase-03-videos/TD-07)_ — TD-07 decided: A (spawn ffprobe/ffmpeg directly).
- **OQ-8** _(resolved_by phase-03-videos/TD-08)_ — TD-08 decided: A (presigned GET URL as FFmpeg input).
- **OQ-9** _(resolved_by phase-03-videos/TD-09)_ — TD-09 decided: A (frame at 10% of duration, JPEG ≤1280px).
- **OQ-10** _(resolved_by phase-03-videos/TD-10)_ — TD-10 decided: B (11-char base64url slug + unique index + retry).
- **OQ-11** _(resolved_by phase-03-videos/TD-11)_ — TD-11 decided: A (302 to presigned GET; storage serves Range/206).
- **OQ-12** _(resolved_by phase-03-videos/TD-12)_ — TD-12 decided: A (draft → processing → ready | failed, 3 attempts).
- **OQ-13** _(resolved_by phase-03-videos/TD-13)_ — TD-13 decided: A (`{ videoId }`, `jobId = videoId`).
- **OQ-14** _(resolved_by phase-03-videos/TD-14)_ — TD-14 decided: A (real Compose services + fixture + in-process worker).
- **OQ-15** _(resolved_by phase-03-videos/TD-15)_ — TD-15 decided: A (storage-level expiry, 24h).
