import type { PopupState } from './language-pairs.js';

export const MSG = {
  PING: 'translator/ping',
  TRANSLATE_PAGE: 'translator/translate-page',
  RESTORE_PAGE: 'translator/restore-page',
  TRANSLATE_BATCH: 'translator/translate-batch',
  GET_POPUP_STATE: 'translator/get-popup-state',
  SELECT_PAIR: 'translator/select-pair',
  REMOVE_PAIR: 'translator/remove-pair',
  TRANSLATE_ACTIVE_TAB: 'translator/translate-active-tab',
  RESTORE_ACTIVE_TAB: 'translator/restore-active-tab',
  REFRESH_PAIRS: 'translator/refresh-pairs',
} as const;

export interface PingMsg {
  type: typeof MSG.PING;
}
export interface AckMsg {
  ok: true;
}
export interface TranslatePageMsg {
  type: typeof MSG.TRANSLATE_PAGE;
}
export interface RestorePageMsg {
  type: typeof MSG.RESTORE_PAGE;
}
export interface TranslateBatchMsg {
  type: typeof MSG.TRANSLATE_BATCH;
  strings: string[];
}
export interface TranslateBatchReply {
  results: string[];
}
export interface GetPopupStateMsg {
  type: typeof MSG.GET_POPUP_STATE;
  tabId?: number;
}
export interface SelectPairMsg {
  type: typeof MSG.SELECT_PAIR;
  pairKey: string;
}
export interface RemovePairMsg {
  type: typeof MSG.REMOVE_PAIR;
  pairKey: string;
}
export interface TranslateActiveTabMsg {
  type: typeof MSG.TRANSLATE_ACTIVE_TAB;
  tabId: number;
}
export interface RestoreActiveTabMsg {
  type: typeof MSG.RESTORE_ACTIVE_TAB;
  tabId: number;
}
export interface RefreshPairsMsg {
  type: typeof MSG.REFRESH_PAIRS;
}
export interface PopupStateReply {
  state: PopupState;
}

export type AnyMsg =
  | PingMsg
  | TranslatePageMsg
  | RestorePageMsg
  | TranslateBatchMsg
  | GetPopupStateMsg
  | SelectPairMsg
  | RemovePairMsg
  | TranslateActiveTabMsg
  | RestoreActiveTabMsg
  | RefreshPairsMsg;
