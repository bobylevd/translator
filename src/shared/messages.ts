export const MSG = {
  PING: 'translator/ping',
  TRANSLATE_PAGE: 'translator/translate-page',
  RESTORE_PAGE: 'translator/restore-page',
  TRANSLATE_BATCH: 'translator/translate-batch',
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

export type AnyMsg = PingMsg | TranslatePageMsg | RestorePageMsg | TranslateBatchMsg;
