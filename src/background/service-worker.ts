import { MSG, type AnyMsg, type TranslateBatchReply } from '../shared/messages.js';
import { ready, translate } from './engine.js';
import * as tabState from './tab-state.js';

async function injectAllFrames(tabId: number): Promise<void> {
  await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ['content/main.js'],
    injectImmediately: true,
  });
}

async function frameIds(tabId: number): Promise<number[]> {
  try {
    const frames = await browser.webNavigation.getAllFrames({ tabId });
    return (frames ?? []).map(f => f.frameId);
  } catch {
    return [0];
  }
}

async function broadcast(tabId: number, msg: object): Promise<void> {
  const ids = await frameIds(tabId);
  await Promise.allSettled(
    ids.map(frameId => browser.tabs.sendMessage(tabId, msg, { frameId })),
  );
}

async function handleAction(tab: browser.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  const tabId = tab.id;

  const phase = tabState.get(tabId);
  if (phase === 'translating') return;

  if (phase === 'translated') {
    await tabState.set(tabId, 'idle');
    try {
      await broadcast(tabId, { type: MSG.RESTORE_PAGE });
    } catch (err) {
      console.error('[translator/bg] restore failed:', err);
    }
    return;
  }

  await tabState.set(tabId, 'translating');
  try {
    await injectAllFrames(tabId);
    await ready();
    const t0 = performance.now();
    await broadcast(tabId, { type: MSG.TRANSLATE_PAGE });
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

console.log('[translator/bg] background loaded');
