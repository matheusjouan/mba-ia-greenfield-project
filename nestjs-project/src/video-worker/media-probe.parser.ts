import { InvalidMediaError } from './media-probe.types';
import type { MediaProbeResult } from './media-probe.types';

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: {
    format_name?: string;
    duration?: string;
    bit_rate?: string;
  };
}

/** Parses `ffprobe -print_format json -show_format -show_streams` output. */
export function parseFfprobeOutput(output: unknown): MediaProbeResult {
  const { streams = [], format = {} } = (output ?? {}) as FfprobeOutput;
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');

  if (!video || !video.width || !video.height) {
    throw new InvalidMediaError('No video stream found');
  }

  const durationSeconds = Number.parseFloat(format.duration ?? '');
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new InvalidMediaError('Media has no duration');
  }

  return {
    durationSeconds,
    width: video.width,
    height: video.height,
    formatName: format.format_name ?? null,
    bitRate: toNumberOrNull(format.bit_rate),
    videoCodec: video.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    frameRate:
      parseFrameRate(video.avg_frame_rate) ??
      parseFrameRate(video.r_frame_rate),
  };
}

/** "30000/1001" → 29.97; "0/0" or malformed → null. */
function parseFrameRate(rate: string | undefined): number | null {
  if (!rate) return null;
  const [numerator, denominator] = rate.split('/').map(Number);
  if (!numerator || !denominator) return null;
  return Math.round((numerator / denominator) * 100) / 100;
}

function toNumberOrNull(value: string | undefined): number | null {
  const parsed = Number(value);
  return value !== undefined && Number.isFinite(parsed) ? parsed : null;
}
