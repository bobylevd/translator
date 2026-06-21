import { pairShortLabel, type LanguagePair, type PopupState } from '../shared/language-pairs.js';
import { MSG, type PopupStateReply } from '../shared/messages.js';

const sourceSelect = document.querySelector<HTMLSelectElement>('#source')!;
const targetSelect = document.querySelector<HTMLSelectElement>('#target')!;
const statusEl = document.querySelector<HTMLElement>('#status')!;
const progressEl = document.querySelector<HTMLProgressElement>('#progress')!;
const downloadButton = document.querySelector<HTMLButtonElement>('#download')!;
const translateButton = document.querySelector<HTMLButtonElement>('#translate')!;
const restoreButton = document.querySelector<HTMLButtonElement>('#restore')!;
const removeButton = document.querySelector<HTMLButtonElement>('#remove')!;
const refreshButton = document.querySelector<HTMLButtonElement>('#refresh')!;

const displayNames = typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames([navigator.language], { type: 'language' })
  : null;

let activeTabId: number | undefined;
let state: PopupState | null = null;
let pollHandle: ReturnType<typeof setInterval> | null = null;

function languageName(code: string): string {
  try {
    return displayNames?.of(code) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

function selectedPair(): LanguagePair | undefined {
  const key = targetSelect.value;
  return state?.pairs.find(pair => pair.key === key);
}

function pairsForSource(source: string): LanguagePair[] {
  return (state?.pairs ?? []).filter(pair => pair.fromLang === source);
}

function installed(pairKey: string | undefined): boolean {
  return Boolean(pairKey && state?.installedPairKeys.includes(pairKey));
}

function setOptions(select: HTMLSelectElement, options: Array<{ value: string; label: string }>, value?: string): void {
  select.replaceChildren();
  for (const option of options) {
    const el = document.createElement('option');
    el.value = option.value;
    el.textContent = option.label;
    select.append(el);
  }
  if (value && options.some(option => option.value === value)) select.value = value;
}

async function currentTabId(): Promise<number | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function loadState(): Promise<void> {
  activeTabId = await currentTabId();
  const reply = (await browser.runtime.sendMessage({
    type: MSG.GET_POPUP_STATE,
    tabId: activeTabId,
  })) as PopupStateReply;
  state = reply.state;
  render();
}

function render(): void {
  if (!state) return;

  const selected = state.pairs.find(pair => pair.key === state?.selectedPairKey) ?? state.pairs[0];
  const sources = Array.from(new Set(state.pairs.map(pair => pair.fromLang))).sort((a, b) => languageName(a).localeCompare(languageName(b)));
  setOptions(sourceSelect, sources.map(code => ({ value: code, label: languageName(code) })), selected?.fromLang);

  const targets = pairsForSource(sourceSelect.value).sort((a, b) => languageName(a.toLang).localeCompare(languageName(b.toLang)));
  setOptions(
    targetSelect,
    targets.map(pair => ({ value: pair.key, label: `${languageName(pair.toLang)} (${pair.version})` })),
    selected?.key,
  );

  const pair = selectedPair();
  const downloading = pair && state.download?.pairKey === pair.key && state.download.status === 'downloading';
  const failed = pair && state.download?.pairKey === pair.key && state.download.status === 'failed';
  const isInstalled = installed(pair?.key);
  const sizeMb = pair ? (pair.size / 1024 / 1024).toFixed(1) : '0';

  if (!pair) {
    statusEl.textContent = 'No language pairs available.';
  } else if (downloading) {
    const received = state.download?.receivedBytes ?? 0;
    const total = state.download?.totalBytes || pair.size;
    statusEl.textContent = `Downloading ${pairShortLabel(pair)} (${(received / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB)`;
    progressEl.max = total;
    progressEl.value = received;
  } else if (failed) {
    statusEl.textContent = `Download failed: ${state.download?.error ?? 'unknown error'}`;
  } else if (isInstalled) {
    statusEl.textContent = `${pairShortLabel(pair)} is ready.`;
    progressEl.value = pair.size;
    progressEl.max = pair.size;
  } else {
    statusEl.textContent = `${pairShortLabel(pair)} requires ${sizeMb} MB.`;
    progressEl.value = 0;
    progressEl.max = pair.size;
  }

  progressEl.hidden = !downloading;
  downloadButton.disabled = !pair || downloading || isInstalled;
  downloadButton.textContent = failed ? 'Retry' : 'Download';
  translateButton.disabled = !activeTabId || !pair || !isInstalled || state.tabPhase === 'translating';
  restoreButton.disabled = !activeTabId || state.tabPhase !== 'translated';
  removeButton.disabled = !pair || downloading || !isInstalled;

  if (downloading && !pollHandle) {
    pollHandle = setInterval(() => loadState().catch(showError), 1000);
  } else if (!downloading && pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

function showError(err: unknown): void {
  statusEl.textContent = err instanceof Error ? err.message : String(err);
}

async function selectPair(pairKey: string): Promise<void> {
  await browser.runtime.sendMessage({ type: MSG.SELECT_PAIR, pairKey });
  await loadState();
}

sourceSelect.addEventListener('change', () => {
  const pair = pairsForSource(sourceSelect.value)[0];
  if (pair) selectPair(pair.key).catch(showError);
});

targetSelect.addEventListener('change', () => {
  if (targetSelect.value) selectPair(targetSelect.value).catch(showError);
});

downloadButton.addEventListener('click', () => {
  const pair = selectedPair();
  if (pair) selectPair(pair.key).catch(showError);
});

translateButton.addEventListener('click', async () => {
  if (!activeTabId) return;
  await browser.runtime.sendMessage({ type: MSG.TRANSLATE_ACTIVE_TAB, tabId: activeTabId });
  await loadState();
});

restoreButton.addEventListener('click', async () => {
  if (!activeTabId) return;
  await browser.runtime.sendMessage({ type: MSG.RESTORE_ACTIVE_TAB, tabId: activeTabId });
  await loadState();
});

removeButton.addEventListener('click', async () => {
  const pair = selectedPair();
  if (!pair) return;
  await browser.runtime.sendMessage({ type: MSG.REMOVE_PAIR, pairKey: pair.key });
  await loadState();
});

refreshButton.addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: MSG.REFRESH_PAIRS });
  await loadState();
});

loadState().catch(showError);
