import type { LanguagePair, PopupState } from '../shared/language-pairs.js';
import { MSG, type AnyMsg, type PopupStateReply, type TranslateBatchReply } from '../shared/messages.js';
import { getDownloadState, ensurePairDownloaded } from './model-downloads.js';
import { loadPair as loadEnginePair, translate } from './engine.js';
import { getLanguagePairs } from './model-registry.js';
import {
  getInstalledPairs,
  getSelectedPairKey,
  isPairInstalled,
  loadPair as loadStoredPair,
  removePair,
  setSelectedPairKey,
} from './model-store.js';
import * as tabState from './tab-state.js';

interface ActionReply {
  ok: boolean;
  error?: string;
}

async function injectContentScript(tabId: number): Promise<void> {
  await browser.scripting.executeScript({
    target: { tabId },
    files: ['content/main.js'],
    injectImmediately: true,
  });
}

async function sendToPage(tabId: number, msg: object): Promise<ActionReply> {
  const reply = (await browser.tabs.sendMessage(tabId, msg, { frameId: 0 })) as ActionReply | undefined;
  if (!reply?.ok) throw new Error(reply?.error ?? 'content script did not acknowledge action');
  return reply;
}

async function handleAction(tab: browser.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  await translateTab(tab.id);
}

async function selectedInstalledPair(): Promise<LanguagePair> {
  const selectedPairKey = await getSelectedPairKey();
  if (!selectedPairKey) throw new Error('No language pair selected');
  const installed = await getInstalledPairs();
  const pair = installed[selectedPairKey];
  if (!pair) throw new Error('Selected language pair is not downloaded');
  return pair;
}

async function ensureSelectedEnginePair(): Promise<LanguagePair> {
  const pair = await selectedInstalledPair();
  const stored = await loadStoredPair(pair.key);
  await loadEnginePair(stored.pair, stored.files);
  return stored.pair;
}

async function translateTab(tabId: number): Promise<void> {
  const phase = tabState.get(tabId);
  if (phase === 'translating') return;

  if (phase === 'translated') {
    try {
      await sendToPage(tabId, { type: MSG.RESTORE_PAGE });
    } catch (err) {
      console.error('[translator/bg] restore failed:', err);
    } finally {
      await tabState.set(tabId, 'idle');
    }
    return;
  }

  await tabState.set(tabId, 'translating');
  try {
    const pair = await ensureSelectedEnginePair();
    await injectContentScript(tabId);
    const t0 = performance.now();
    await sendToPage(tabId, { type: MSG.TRANSLATE_PAGE });
    const ms = Math.round(performance.now() - t0);
    console.log(`[translator/bg] page translated in ${ms}ms`);
    await tabState.set(tabId, 'translated', pair.toLang);
  } catch (err) {
    console.error('[translator/bg] translate failed:', err);
    await tabState.set(tabId, 'idle');
  }
}

async function restoreTab(tabId: number): Promise<void> {
  try {
    await sendToPage(tabId, { type: MSG.RESTORE_PAGE });
  } catch (err) {
    console.error('[translator/bg] restore failed:', err);
  } finally {
    await tabState.set(tabId, 'idle');
  }
}

async function popupState(tabId?: number): Promise<PopupState> {
  const [pairs, selectedPairKey, installed] = await Promise.all([
    getLanguagePairs(),
    getSelectedPairKey(),
    getInstalledPairs(),
  ]);
  return {
    pairs,
    selectedPairKey,
    installedPairKeys: Object.keys(installed),
    download: getDownloadState(selectedPairKey),
    tabPhase: tabId === undefined ? 'idle' : tabState.get(tabId),
  };
}

async function selectPair(pairKey: string): Promise<void> {
  const pairs = await getLanguagePairs();
  const pair = pairs.find(p => p.key === pairKey);
  if (!pair) throw new Error(`Unknown language pair: ${pairKey}`);
  await setSelectedPairKey(pairKey);
  if (!(await isPairInstalled(pairKey))) {
    ensurePairDownloaded(pair).catch(err => console.error('[translator/bg] model download failed:', err));
  }
}

browser.runtime.onMessage.addListener((msg: AnyMsg): Promise<TranslateBatchReply | PopupStateReply | { ok: true }> | undefined => {
  if (msg.type === MSG.TRANSLATE_BATCH) {
    return ensureSelectedEnginePair().then(pair => translate(pair.key, msg.strings).then(results => ({ results })));
  }
  if (msg.type === MSG.GET_POPUP_STATE) {
    return popupState(msg.tabId).then(state => ({ state }));
  }
  if (msg.type === MSG.SELECT_PAIR) {
    return selectPair(msg.pairKey).then(() => ({ ok: true }));
  }
  if (msg.type === MSG.REMOVE_PAIR) {
    return removePair(msg.pairKey).then(() => ({ ok: true }));
  }
  if (msg.type === MSG.TRANSLATE_ACTIVE_TAB) {
    return translateTab(msg.tabId).then(() => ({ ok: true }));
  }
  if (msg.type === MSG.RESTORE_ACTIVE_TAB) {
    return restoreTab(msg.tabId).then(() => ({ ok: true }));
  }
  if (msg.type === MSG.REFRESH_PAIRS) {
    return getLanguagePairs(true).then(() => ({ ok: true }));
  }
  return undefined;
});

browser.action.onClicked.addListener(tab => {
  handleAction(tab).catch(err => console.error('[translator/bg] action failed:', err));
});

browser.tabs.onRemoved.addListener(tabId => tabState.forget(tabId));
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabState.set(tabId, 'idle').catch(err => console.error('[translator/bg] failed to reset tab state:', err));
  }
});

console.log('[translator/bg] background loaded');
