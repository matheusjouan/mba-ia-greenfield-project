import { parseFfprobeOutput } from './media-probe.parser';
import { InvalidMediaError } from './media-probe.types';

const videoStream = {
  codec_type: 'video',
  codec_name: 'h264',
  width: 1920,
  height: 1080,
  r_frame_rate: '30000/1001',
  avg_frame_rate: '30000/1001',
};
const audioStream = { codec_type: 'audio', codec_name: 'aac' };
const format = {
  format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
  duration: '12.345000',
  bit_rate: '2500000',
};

describe('parseFfprobeOutput', () => {
  it('should extract duration, dimensions, codecs and bit rate', () => {
    const result = parseFfprobeOutput({
      streams: [videoStream, audioStream],
      format,
    });

    expect(result).toEqual({
      durationSeconds: 12.345,
      width: 1920,
      height: 1080,
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
      bitRate: 2500000,
      videoCodec: 'h264',
      audioCodec: 'aac',
      frameRate: 29.97,
    });
  });

  it('should report a null audio codec for silent videos', () => {
    const result = parseFfprobeOutput({ streams: [videoStream], format });

    expect(result.audioCodec).toBeNull();
  });

  it('should fall back to r_frame_rate when avg_frame_rate is 0/0', () => {
    const result = parseFfprobeOutput({
      streams: [
        { ...videoStream, avg_frame_rate: '0/0', r_frame_rate: '25/1' },
      ],
      format,
    });

    expect(result.frameRate).toBe(25);
  });

  it('should reject media without a video stream', () => {
    expect(() =>
      parseFfprobeOutput({ streams: [audioStream], format }),
    ).toThrow(InvalidMediaError);
  });

  it('should reject media without a duration', () => {
    expect(() =>
      parseFfprobeOutput({
        streams: [videoStream],
        format: { ...format, duration: 'N/A' },
      }),
    ).toThrow(InvalidMediaError);
  });

  it('should reject an empty ffprobe output', () => {
    expect(() => parseFfprobeOutput({})).toThrow(InvalidMediaError);
  });
});
