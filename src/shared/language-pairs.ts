export const REMOTE_SETTINGS_RECORDS_URL =
  'https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/translations-models/records?_limit=10000';
export const ATTACHMENT_BASE_URL = 'https://firefox-settings-attachments.cdn.mozilla.net/';

export type ModelFileType = 'model' | 'lex' | 'vocab' | 'srcvocab' | 'trgvocab';

export interface ModelFileMeta {
  type: ModelFileType;
  name: string;
  hash: string;
  size: number;
  url: string;
}

export interface LanguagePair {
  key: string;
  fromLang: string;
  toLang: string;
  version: string;
  files: Partial<Record<ModelFileType, ModelFileMeta>>;
  size: number;
}

export interface DownloadState {
  pairKey: string;
  status: 'downloading' | 'failed';
  receivedBytes: number;
  totalBytes: number;
  error?: string;
}

export interface PopupState {
  pairs: LanguagePair[];
  selectedPairKey?: string;
  installedPairKeys: string[];
  download?: DownloadState;
  tabPhase: 'idle' | 'translating' | 'translated';
}

export function pairKey(fromLang: string, toLang: string, version: string): string {
  return `${fromLang}->${toLang}@${version}`;
}

export function pairShortLabel(pair: Pick<LanguagePair, 'fromLang' | 'toLang'>): string {
  return `${pair.fromLang.toUpperCase()} → ${pair.toLang.toUpperCase()}`;
}

export function requiredFileTypes(pair: LanguagePair): ModelFileType[] {
  const types: ModelFileType[] = ['model'];
  if (pair.files.lex) types.push('lex');
  if (pair.files.vocab) {
    types.push('vocab');
  } else {
    types.push('srcvocab', 'trgvocab');
  }
  return types;
}
