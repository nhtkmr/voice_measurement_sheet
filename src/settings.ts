// アプリ設定（localStorage 永続化）

const NG_VOICE_KEY = 'vms.ngVoice';
const ADVANCE_DIR_KEY = 'vms.advanceDir';

/** NG時の「NGです」音声読み上げが有効か（既定: 有効） */
export function getNgVoice(): boolean {
  return localStorage.getItem(NG_VOICE_KEY) !== '0';
}

export function setNgVoice(enabled: boolean): void {
  localStorage.setItem(NG_VOICE_KEY, enabled ? '1' : '0');
}

/** 入力後にカーソルが進む方向。'item'=項目方向(横) / 'row'=No.方向(縦)。既定: 'item' */
export type AdvanceDir = 'item' | 'row';

export function getAdvanceDir(): AdvanceDir {
  return localStorage.getItem(ADVANCE_DIR_KEY) === 'row' ? 'row' : 'item';
}

export function setAdvanceDir(dir: AdvanceDir): void {
  localStorage.setItem(ADVANCE_DIR_KEY, dir);
}
