import type { FFmpeg } from '@ffmpeg/ffmpeg';

/**
 * Compresses a video in the browser to 720p MP4 (H.264 + AAC) before upload, so
 * raw phone footage never lands in the coach's storage. Runs ffmpeg compiled to
 * WebAssembly, loaded on first use from a CDN (about 30 MB, cached afterwards),
 * so it costs nothing on pages that never upload a video.
 *
 * Single-threaded on purpose: the multi-threaded build needs cross-origin
 * isolation headers (COOP/COEP) that would break the app's other embeds.
 */

const CORE_VERSION = '0.12.10';
/** Tried in order. A CDN that stalls (it happens) is abandoned after FETCH_TIMEOUT_MS and the next one is used. */
const CORE_BASES = [
  `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
];
const FETCH_TIMEOUT_MS = 60_000;

/** ffmpeg.wasm holds the whole file in memory (32-bit address space), so very large sources cannot be handled. */
export const MAX_SOURCE_BYTES = 1024 * 1024 * 1024;

export class VideoCompressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoCompressError';
  }
}

let loading: Promise<FFmpeg> | null = null;

/** Downloads a file into a blob: URL, giving up if it takes longer than FETCH_TIMEOUT_MS overall. */
async function fetchAsBlobUrl(url: string, mime: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
    const blob = await res.blob();
    return URL.createObjectURL(new Blob([blob], { type: mime }));
  } finally {
    clearTimeout(timer);
  }
}

async function getFfmpeg(): Promise<FFmpeg> {
  if (!loading) {
    loading = (async () => {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      let lastError: unknown;
      for (const base of CORE_BASES) {
        try {
          const coreURL = await fetchAsBlobUrl(`${base}/ffmpeg-core.js`, 'text/javascript');
          const wasmURL = await fetchAsBlobUrl(`${base}/ffmpeg-core.wasm`, 'application/wasm');
          const ffmpeg = new FFmpeg();
          await ffmpeg.load({ coreURL, wasmURL });
          return ffmpeg;
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError ?? new Error('no source reachable');
    })().catch((err) => {
      loading = null; // let the next attempt retry the download
      throw new VideoCompressError(
        'Could not load the video compressor. Check your connection and try again.' +
          (err instanceof Error && err.message ? ` (${err.message})` : ''),
      );
    });
  }
  return loading;
}

/** Length of a video file in seconds, read from its metadata. Undefined when the browser cannot tell. */
export function readVideoDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement('video');
    const done = (value: number | undefined) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    el.preload = 'metadata';
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : undefined);
    el.onerror = () => done(undefined);
    el.src = url;
  });
}

/**
 * The longer edge becomes at most 1280 px and the shorter at most 720: landscape
 * 1280x720, portrait 720x1280. A smaller video is never scaled up. `-2` keeps the
 * other side even, which H.264 requires.
 */
const SCALE_FILTER = "scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)'";

/** Re-encodes `file`. `onProgress` is 0 to 1. */
export async function compressVideo(file: File, onProgress?: (fraction: number) => void): Promise<File> {
  if (file.size > MAX_SOURCE_BYTES) {
    throw new VideoCompressError('That video is over 1 GB, which is too large to compress in the browser. Trim it or compress it first.');
  }
  const ffmpeg = await getFfmpeg();
  const { fetchFile } = await import('@ffmpeg/util');

  const handler = ({ progress }: { progress: number }) => onProgress?.(Math.max(0, Math.min(1, progress)));
  ffmpeg.on('progress', handler);
  const input = 'input';
  const output = 'output.mp4';
  try {
    await ffmpeg.writeFile(input, await fetchFile(file));
    const code = await ffmpeg.exec([
      '-i', input,
      '-vf', SCALE_FILTER,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k',
      // Metadata up front so the video starts playing before it has fully downloaded.
      '-movflags', '+faststart',
      output,
    ]);
    if (code !== 0) throw new VideoCompressError('That video could not be compressed. It may be in an unsupported format.');
    const data = (await ffmpeg.readFile(output)) as Uint8Array;
    const base = file.name.replace(/\.[^.]+$/, '') || 'video';
    // Copy into a fresh buffer: the wasm heap view is detached once the files are deleted.
    return new File([new Uint8Array(data)], `${base}.mp4`, { type: 'video/mp4' });
  } finally {
    ffmpeg.off('progress', handler);
    await ffmpeg.deleteFile(input).catch(() => undefined);
    await ffmpeg.deleteFile(output).catch(() => undefined);
  }
}
