export interface MediaProbeResult {
  durationSeconds: number;
  width: number;
  height: number;
  formatName: string | null;
  bitRate: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  frameRate: number | null;
}

/** The input is not a usable video: retrying cannot fix it. */
export class InvalidMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMediaError';
  }
}
