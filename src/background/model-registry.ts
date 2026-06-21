import {
  ATTACHMENT_BASE_URL,
  REMOTE_SETTINGS_RECORDS_URL,
  pairKey,
  type LanguagePair,
  type ModelFileMeta,
  type ModelFileType,
} from '../shared/language-pairs.js';

const REGISTRY_CACHE_KEY = 'translator.registryCache';
const REGISTRY_TTL_MS = 12 * 60 * 60 * 1000;

interface RemoteRecord {
  fromLang: string;
  toLang: string;
  version: string;
  fileType: string;
  name: string;
  hash: string;
  last_modified?: number;
  attachment?: {
    hash?: string;
    size?: number;
    location?: string;
    filename?: string;
  };
}

interface RegistryCache {
  fetchedAt: number;
  pairs: LanguagePair[];
}

const FILE_TYPES = new Set<ModelFileType>(['model', 'lex', 'vocab', 'srcvocab', 'trgvocab']);

function isModelFileType(value: string): value is ModelFileType {
  return FILE_TYPES.has(value as ModelFileType);
}

function compareVersions(a: string, b: string): number {
  const aa = a.split('.').map(n => Number.parseInt(n, 10));
  const bb = b.split('.').map(n => Number.parseInt(n, 10));
  const len = Math.max(aa.length, bb.length);
  for (let i = 0; i < len; i++) {
    const av = Number.isFinite(aa[i]) ? aa[i]! : 0;
    const bv = Number.isFinite(bb[i]) ? bb[i]! : 0;
    if (av !== bv) return av - bv;
  }
  return a.localeCompare(b);
}

function complete(pair: LanguagePair): boolean {
  return Boolean(pair.files.model && (pair.files.vocab || (pair.files.srcvocab && pair.files.trgvocab)));
}

export function normalizeModelRecords(records: RemoteRecord[]): LanguagePair[] {
  const groups = new Map<string, { pair: LanguagePair; lastModified: number; fileModified: Partial<Record<ModelFileType, number>> }>();

  for (const record of records) {
    if (!isModelFileType(record.fileType)) continue;
    if (!record.fromLang || !record.toLang || !record.version) continue;
    const location = record.attachment?.location;
    const size = record.attachment?.size;
    if (!location || size === undefined) continue;

    const key = pairKey(record.fromLang, record.toLang, record.version);
    let group = groups.get(key);
    if (!group) {
      group = {
        pair: {
          key,
          fromLang: record.fromLang,
          toLang: record.toLang,
          version: record.version,
          files: {},
          size: 0,
        },
        lastModified: 0,
        fileModified: {},
      };
      groups.set(key, group);
    }

    const type = record.fileType;
    const current = group.pair.files[type];
    const currentModified = group.fileModified[type] ?? 0;
    const hash = record.attachment?.hash ?? record.hash;
    const file: ModelFileMeta = {
      type,
      name: record.name,
      hash,
      size,
      url: new URL(location, ATTACHMENT_BASE_URL).href,
    };

    if (!current || (record.last_modified ?? 0) >= currentModified) {
      group.pair.files[type] = file;
      group.fileModified[type] = record.last_modified ?? 0;
    }
    group.lastModified = Math.max(group.lastModified, record.last_modified ?? 0);
  }

  const latestByDirection = new Map<string, { pair: LanguagePair; lastModified: number }>();
  for (const group of groups.values()) {
    if (!complete(group.pair)) continue;
    group.pair.size = Object.values(group.pair.files).reduce((sum, file) => sum + (file?.size ?? 0), 0);
    const directionKey = `${group.pair.fromLang}->${group.pair.toLang}`;
    const current = latestByDirection.get(directionKey);
    if (
      !current ||
      compareVersions(group.pair.version, current.pair.version) > 0 ||
      (group.pair.version === current.pair.version && group.lastModified > current.lastModified)
    ) {
      latestByDirection.set(directionKey, group);
    }
  }

  return Array.from(latestByDirection.values())
    .map(group => group.pair)
    .sort((a, b) => a.fromLang.localeCompare(b.fromLang) || a.toLang.localeCompare(b.toLang));
}

async function readCache(): Promise<RegistryCache | undefined> {
  const result = await browser.storage.local.get(REGISTRY_CACHE_KEY);
  return result[REGISTRY_CACHE_KEY] as RegistryCache | undefined;
}

async function writeCache(pairs: LanguagePair[]): Promise<void> {
  await browser.storage.local.set({
    [REGISTRY_CACHE_KEY]: {
      fetchedAt: Date.now(),
      pairs,
    } satisfies RegistryCache,
  });
}

export async function getLanguagePairs(forceRefresh = false): Promise<LanguagePair[]> {
  if (!forceRefresh) {
    const cached = await readCache();
    if (cached && Date.now() - cached.fetchedAt < REGISTRY_TTL_MS) return cached.pairs;
  }

  const res = await fetch(REMOTE_SETTINGS_RECORDS_URL);
  if (!res.ok) throw new Error(`Failed to fetch language pairs: ${res.status}`);
  const json = (await res.json()) as { data?: RemoteRecord[] };
  const pairs = normalizeModelRecords(json.data ?? []);
  await writeCache(pairs);
  return pairs;
}
