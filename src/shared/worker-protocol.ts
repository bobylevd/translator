import type { ModelFileType } from './language-pairs.js';

export interface BergamotUrls {
  bergamotJs: string;
  wasm: string;
}

export interface WorkerPairFile {
  type: ModelFileType;
  buffer: ArrayBuffer;
}

export interface WorkerPairPayload {
  key: string;
  fromLang: string;
  toLang: string;
  files: WorkerPairFile[];
}

export type WorkerRequest =
  | { type: 'INIT_BERGAMOT'; urls: BergamotUrls }
  | { type: 'LOAD_PAIR'; id: number; pair: WorkerPairPayload }
  | { type: 'TRANSLATE'; id: number; pairKey: string; strings: string[]; html: boolean };

export type WorkerResponse =
  | { type: 'READY' }
  | { type: 'PAIR_READY'; id: number; pairKey: string }
  | { type: 'TRANSLATED'; id: number; results: string[]; ms: number }
  | { type: 'ERROR'; id?: number; error: string };
