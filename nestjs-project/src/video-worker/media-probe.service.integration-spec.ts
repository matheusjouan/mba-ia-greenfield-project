import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import storageConfig from '../config/storage.config';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import { MediaProbeService } from './media-probe.service';
import { InvalidMediaError } from './media-probe.types';

const FIXTURE = resolve(__dirname, '../../test/fixtures/sample.mp4');
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

describe('MediaProbeService (integration)', () => {
  const probe = new MediaProbeService();
  let storage: StorageService;
  let workDir: string;
  const storageKey = `test/media-probe-it/${randomUUID()}/source.mp4`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    }).compile();
    storage = moduleRef.get(StorageService);
    await storage.putObject(storageKey, await readFile(FIXTURE), 'video/mp4');
    workDir = await mkdtemp(join(tmpdir(), 'media-probe-it-'));
  });

  afterAll(async () => {
    await storage.deleteObject(storageKey);
    await rm(workDir, { recursive: true, force: true });
  });

  it('extracts duration, dimensions and codecs from a local file', async () => {
    const result = await probe.probe(FIXTURE);

    expect(result.durationSeconds).toBeGreaterThan(2.9);
    expect(result.durationSeconds).toBeLessThan(3.1);
    expect(result.width).toBe(320);
    expect(result.height).toBe(240);
    expect(result.videoCodec).toBe('h264');
    expect(result.audioCodec).toBe('aac');
    expect(result.frameRate).toBe(15);
  });

  it('probes the object over a presigned URL without downloading it first', async () => {
    const url = await storage.presignGetObject(storageKey, {
      expiresIn: 300,
      endpoint: 'internal',
    });

    const result = await probe.probe(url);

    expect(result.width).toBe(320);
    expect(result.height).toBe(240);
    expect(result.durationSeconds).toBeGreaterThan(2.9);
  });

  it('writes a JPEG thumbnail no wider than 1280px', async () => {
    const url = await storage.presignGetObject(storageKey, {
      expiresIn: 300,
      endpoint: 'internal',
    });
    const output = join(workDir, 'thumbnail.jpg');

    await probe.extractThumbnail(url, 0.3, output);

    const bytes = await readFile(output);
    expect(bytes.subarray(0, 3).equals(JPEG_SIGNATURE)).toBe(true);
    const width = Number(
      execFileSync('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width',
        '-of',
        'csv=p=0',
        output,
      ])
        .toString()
        .trim(),
    );
    expect(width).toBe(320);
    expect(width).toBeLessThanOrEqual(1280);
  });

  it('rejects bytes that are not a video with InvalidMediaError', async () => {
    const garbage = join(workDir, 'garbage.mp4');
    await writeFile(garbage, randomBytes(4096));

    await expect(probe.probe(garbage)).rejects.toThrow(InvalidMediaError);
  });

  it('treats an unreachable storage as a transient failure', async () => {
    const error = await probe
      .probe('http://minio:1/streamtube/missing.mp4')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(InvalidMediaError);
  });
});
