import { spawn } from 'node:child_process';
import { Injectable } from '@nestjs/common';
import { parseFfprobeOutput } from './media-probe.parser';
import { InvalidMediaError } from './media-probe.types';
import type { MediaProbeResult } from './media-probe.types';

const PROBE_TIMEOUT_MS = 60_000;
const THUMBNAIL_TIMEOUT_MS = 120_000;
const THUMBNAIL_MAX_WIDTH = 1280;
// Failures reading the input over HTTP are transient: let the queue retry them
const TRANSIENT_FAILURE =
  /connection refused|timed out|network is unreachable|could not resolve|server returned 5\d\d/i;

/**
 * Thin wrapper over the FFmpeg binaries. Inputs may be local paths or HTTP
 * URLs (presigned storage URLs): FFmpeg reads only the byte ranges it needs.
 */
@Injectable()
export class MediaProbeService {
  async probe(input: string): Promise<MediaProbeResult> {
    const stdout = await this.run(
      'ffprobe',
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        input,
      ],
      PROBE_TIMEOUT_MS,
    );

    let output: unknown;
    try {
      output = JSON.parse(stdout);
    } catch {
      throw new InvalidMediaError('ffprobe returned unreadable output');
    }
    return parseFfprobeOutput(output);
  }

  /** Writes a JPEG of the frame at `atSeconds`, at most 1280px wide. */
  async extractThumbnail(
    input: string,
    atSeconds: number,
    outputPath: string,
  ): Promise<void> {
    await this.run(
      'ffmpeg',
      [
        '-v',
        'error',
        // Input seeking: fetch only the bytes around the target frame
        '-ss',
        atSeconds.toFixed(3),
        '-i',
        input,
        '-frames:v',
        '1',
        '-vf',
        `scale='min(${THUMBNAIL_MAX_WIDTH},iw)':-2`,
        '-q:v',
        '3',
        '-y',
        outputPath,
      ],
      THUMBNAIL_TIMEOUT_MS,
    );
  }

  private run(
    command: string,
    args: string[],
    timeoutMs: number,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { timeout: timeoutMs });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('error', reject);
      child.on('close', (code, signal) => {
        if (code === 0) {
          resolve(stdout);
          return;
        }
        const detail = stderr.trim() || `${command} exited with ${code}`;
        if (signal || TRANSIENT_FAILURE.test(detail)) {
          reject(new Error(`${command} failed: ${signal ?? detail}`));
          return;
        }
        reject(new InvalidMediaError(`${command} failed: ${detail}`));
      });
    });
  }
}
