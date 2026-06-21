import { requiredFileTypes, type DownloadState, type LanguagePair, type ModelFileMeta, type ModelFileType } from '../shared/language-pairs.js';
import { savePair, type StoredPairFile } from './model-store.js';

const downloads = new Map<string, DownloadState>();
const inFlight = new Map<string, Promise<void>>();

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function bytesToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  return bytesToHex(await crypto.subtle.digest('SHA-256', buffer));
}

async function downloadFile(meta: ModelFileMeta, pairKey: string): Promise<ArrayBuffer> {
  const res = await fetch(meta.url);
  if (!res.ok) throw new Error(`Failed to download ${meta.name}: ${res.status}`);

  let buffer: ArrayBuffer;
  const reader = res.body?.getReader();
  if (reader) {
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      received += value.byteLength;
      const state = downloads.get(pairKey);
      if (state?.status === 'downloading') {
        state.receivedBytes += value.byteLength;
        downloads.set(pairKey, state);
      }
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    buffer = bytes.buffer;
  } else {
    buffer = await res.arrayBuffer();
    const state = downloads.get(pairKey);
    if (state?.status === 'downloading') {
      state.receivedBytes += buffer.byteLength;
      downloads.set(pairKey, state);
    }
  }

  const actual = await sha256Hex(buffer);
  if (actual !== meta.hash) {
    throw new Error(`SHA-256 mismatch for ${meta.name}`);
  }
  return buffer;
}

export function getDownloadState(pairKey?: string): DownloadState | undefined {
  if (pairKey) return downloads.get(pairKey);
  return Array.from(downloads.values())[0];
}

export async function ensurePairDownloaded(pair: LanguagePair): Promise<void> {
  const existing = inFlight.get(pair.key);
  if (existing) return existing;

  const promise = (async () => {
    const requiredTypes = requiredFileTypes(pair);
    const totalBytes = requiredTypes.reduce((sum, type) => sum + (pair.files[type]?.size ?? 0), 0);
    downloads.set(pair.key, {
      pairKey: pair.key,
      status: 'downloading',
      receivedBytes: 0,
      totalBytes,
    });

    try {
      const files: StoredPairFile[] = [];
      for (const type of requiredTypes) {
        const meta = pair.files[type] as ModelFileMeta | undefined;
        if (!meta) throw new Error(`Missing ${type} file metadata for ${pair.key}`);
        files.push({ type: type as ModelFileType, buffer: await downloadFile(meta, pair.key) });
      }
      await savePair(pair, files);
      downloads.delete(pair.key);
    } catch (err) {
      const state = downloads.get(pair.key);
      downloads.set(pair.key, {
        pairKey: pair.key,
        status: 'failed',
        receivedBytes: state?.receivedBytes ?? 0,
        totalBytes: state?.totalBytes ?? totalBytes,
        error: errorMessage(err),
      });
      throw err;
    } finally {
      inFlight.delete(pair.key);
    }
  })();

  inFlight.set(pair.key, promise);
  return promise;
}
