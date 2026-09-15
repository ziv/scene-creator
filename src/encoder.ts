import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  getFirstEncodableVideoCodec,
  type VideoCodec,
} from 'mediabunny';
import type { RecordingSettings } from './settings';

const CODEC_PREFERENCE: VideoCodec[] = ['avc', 'hevc', 'vp9', 'av1'];

/** MP4 encoding of canvas frames via mediabunny and WebCodecs. */
export class Mp4Encoder {
  private output: Output;
  private source: CanvasSource;
  readonly codec: VideoCodec;
  private frameDuration: number;
  private finished = false;

  private constructor(output: Output, source: CanvasSource, codec: VideoCodec, fps: number) {
    this.output = output;
    this.source = source;
    this.codec = codec;
    this.frameDuration = 1 / fps;
  }

  static async create(canvas: HTMLCanvasElement, video: RecordingSettings['video']): Promise<Mp4Encoder> {
    const format = new Mp4OutputFormat();
    const codec = await getFirstEncodableVideoCodec(
      format.getSupportedVideoCodecs().filter((c) => CODEC_PREFERENCE.includes(c)),
      { width: video.width, height: video.height },
    );
    if (!codec) {
      throw new Error(
        `This browser cannot encode ${video.width}×${video.height} video in any MP4-compatible codec ` +
          `(tried: ${CODEC_PREFERENCE.join(', ')}). Try a lower resolution.`,
      );
    }

    const output = new Output({ format, target: new BufferTarget() });
    const source = new CanvasSource(canvas, { codec, bitrate: video.bitrate });
    output.addVideoTrack(source, { frameRate: video.fps });
    await output.start();
    return new Mp4Encoder(output, source, codec, video.fps);
  }

  /** Captures the canvas' current content as frame `index`. Applies encoder backpressure. */
  async addFrame(index: number): Promise<void> {
    await this.source.add(index * this.frameDuration, this.frameDuration);
  }

  /** Finishes the encode and returns the complete MP4 file. */
  async finalize(): Promise<Blob> {
    this.finished = true;
    this.source.close();
    await this.output.finalize();
    const buffer = (this.output.target as BufferTarget).buffer;
    if (!buffer) throw new Error('Encoding produced no output.');
    return new Blob([buffer], { type: this.output.format.mimeType });
  }

  /** Abandons the encode. Safe to call after finalize (no-op). */
  async cancel(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    await this.output.cancel();
  }
}
