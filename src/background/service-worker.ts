import { MSG, type AnyMsg, type TranslateBatchReply } from '../shared/messages.js';
import { ready, translate } from './engine.js';
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
  const tabId = tab.id;

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
    await injectContentScript(tabId);
    await ready();
    const t0 = performance.now();
    await sendToPage(tabId, { type: MSG.TRANSLATE_PAGE });
    const ms = Math.round(performance.now() - t0);
    console.log(`[translator/bg] page translated in ${ms}ms`);
    await tabState.set(tabId, 'translated');
  } catch (err) {
    console.error('[translator/bg] translate failed:', err);
    await tabState.set(tabId, 'idle');
  }
}

browser.runtime.onMessage.addListener((msg: AnyMsg): Promise<TranslateBatchReply> | undefined => {
  if (msg.type === MSG.TRANSLATE_BATCH) {
    return translate(msg.strings).then(results => ({ results }));
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
