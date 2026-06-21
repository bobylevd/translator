export type TabPhase = 'idle' | 'translating' | 'translated';

const BADGE: Record<TabPhase, { text: string; color: string }> = {
  idle: { text: '', color: '#000000' },
  translating: { text: '…', color: '#e67e22' },
  translated: { text: '', color: '#2e7d32' },
};

const TITLE: Record<TabPhase, string> = {
  idle: 'Translate page',
  translating: 'Translating page…',
  translated: 'Restore original text',
};

const states = new Map<number, TabPhase>();

export function get(tabId: number): TabPhase {
  return states.get(tabId) ?? 'idle';
}

export async function set(tabId: number, phase: TabPhase, targetLang?: string): Promise<void> {
  states.set(tabId, phase);
  const b = BADGE[phase];
  const text = phase === 'translated' && targetLang ? targetLang.toUpperCase().slice(0, 4) : b.text;
  const title = phase === 'translated' && targetLang ? `Restore original text (${targetLang.toUpperCase()})` : TITLE[phase];
  await browser.action.setBadgeText({ tabId, text });
  await browser.action.setBadgeBackgroundColor({ tabId, color: b.color });
  await browser.action.setTitle({ tabId, title });
}

export function forget(tabId: number): void {
  states.delete(tabId);
}
