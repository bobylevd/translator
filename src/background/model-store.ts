import { requiredFileTypes, type LanguagePair, type ModelFileType } from '../shared/language-pairs.js';

const DB_NAME = 'translator-model-cache';
const DB_VERSION = 1;
const FILE_STORE = 'files';
const INSTALLED_KEY = 'translator.installedPairs';
const SELECTED_KEY = 'translator.selectedPairKey';

export interface StoredPairFile {
  type: ModelFileType;
  buffer: ArrayBuffer;
}

export interface StoredPair {
  pair: LanguagePair;
  files: StoredPairFile[];
}

interface FileRecord {
  id: string;
  pairKey: string;
  type: ModelFileType;
  buffer: ArrayBuffer;
}

function fileId(pairKey: string, type: ModelFileType): string {
  return `${pairKey}:${type}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FILE_STORE)) {
        db.createObjectStore(FILE_STORE, { keyPath: 'id' });
      }
    };
    req.onerror = () => reject(req.error ?? new Error('failed to open model cache'));
    req.onsuccess = () => resolve(req.result);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('model cache transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('model cache transaction aborted'));
  });
}

function requestValue<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onerror = () => reject(req.error ?? new Error('model cache request failed'));
    req.onsuccess = () => resolve(req.result);
  });
}

export async function getInstalledPairs(): Promise<Record<string, LanguagePair>> {
  const result = await browser.storage.local.get(INSTALLED_KEY);
  return (result[INSTALLED_KEY] as Record<string, LanguagePair> | undefined) ?? {};
}

export async function isPairInstalled(pairKey: string): Promise<boolean> {
  return Object.hasOwn(await getInstalledPairs(), pairKey);
}

export async function getSelectedPairKey(): Promise<string | undefined> {
  const result = await browser.storage.local.get(SELECTED_KEY);
  return result[SELECTED_KEY] as string | undefined;
}

export async function setSelectedPairKey(pairKey: string | undefined): Promise<void> {
  if (pairKey) {
    await browser.storage.local.set({ [SELECTED_KEY]: pairKey });
  } else {
    await browser.storage.local.remove(SELECTED_KEY);
  }
}

export async function savePair(pair: LanguagePair, files: StoredPairFile[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(FILE_STORE, 'readwrite');
  const store = tx.objectStore(FILE_STORE);
  for (const file of files) {
    store.put({
      id: fileId(pair.key, file.type),
      pairKey: pair.key,
      type: file.type,
      buffer: file.buffer,
    } satisfies FileRecord);
  }
  await transactionDone(tx);
  db.close();

  const installed = await getInstalledPairs();
  installed[pair.key] = pair;
  await browser.storage.local.set({ [INSTALLED_KEY]: installed });
}

export async function loadPair(pairKey: string): Promise<StoredPair> {
  const installed = await getInstalledPairs();
  const pair = installed[pairKey];
  if (!pair) throw new Error(`Language pair is not installed: ${pairKey}`);

  const db = await openDb();
  try {
    const tx = db.transaction(FILE_STORE, 'readonly');
    const store = tx.objectStore(FILE_STORE);
    const files: StoredPairFile[] = [];
    for (const type of requiredFileTypes(pair)) {
      const record = await requestValue<FileRecord | undefined>(store.get(fileId(pairKey, type)) as IDBRequest<FileRecord | undefined>);
      if (!record) throw new Error(`Missing cached ${type} file for ${pairKey}`);
      files.push({ type, buffer: record.buffer });
    }
    return { pair, files };
  } finally {
    db.close();
  }
}

export async function removePair(pairKey: string): Promise<void> {
  const installed = await getInstalledPairs();
  const pair = installed[pairKey];
  if (pair) {
    const db = await openDb();
    const tx = db.transaction(FILE_STORE, 'readwrite');
    const store = tx.objectStore(FILE_STORE);
    for (const type of requiredFileTypes(pair)) {
      store.delete(fileId(pairKey, type));
    }
    await transactionDone(tx);
    db.close();
  }

  delete installed[pairKey];
  const selected = await getSelectedPairKey();
  await browser.storage.local.set({ [INSTALLED_KEY]: installed });
  if (selected === pairKey) await setSelectedPairKey(undefined);
}
