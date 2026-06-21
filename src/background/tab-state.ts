export type TabPhase = 'idle' | 'translating' | 'translated';

const BADGE: Record<TabPhase, { text: string; color: string }> = {
  idle: { text: '', color: '#000000' },
  translating: { text: '…', color: '#e67e22' },
  translated: { text: 'EN', color: '#2e7d32' },
};

const TITLE: Record<TabPhase, string> = {
  idle: 'Translate page (DE → EN)',
  translating: 'Translating page…',
  translated: 'Restore original German text',
};

const states = new Map<number, TabPhase>();

export function get(tabId: number): TabPhase {
  return states.get(tabId) ?? 'idle';
}

export async function set(tabId: number, phase: TabPhase): Promise<void> {
  states.set(tabId, phase);
  const b = BADGE[phase];
  await browser.action.setBadgeText({ tabId, text: b.text });
  await browser.action.setBadgeBackgroundColor({ tabId, color: b.color });
  await browser.action.setTitle({ tabId, title: TITLE[phase] });
}

export function forget(tabId: number): void {
  states.delete(tabId);
}
