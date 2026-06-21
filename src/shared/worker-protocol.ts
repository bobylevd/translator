export interface InitUrls {
  bergamotJs: string;
  wasm: string;
  model: string;
  lex: string;
  vocab: string;
}

export type WorkerRequest =
  | { type: 'INIT'; urls: InitUrls }
  | { type: 'TRANSLATE'; id: number; strings: string[]; html: boolean };

export type WorkerResponse =
  | { type: 'READY' }
  | { type: 'TRANSLATED'; id: number; results: string[]; ms: number }
  | { type: 'ERROR'; id?: number; error: string };
