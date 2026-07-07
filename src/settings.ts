// アプリ設定（localStorage 永続化）

const NG_VOICE_KEY = 'vms.ngVoice';
const ADVANCE_DIR_KEY = 'vms.advanceDir';
const SLOW_INPUT_KEY = 'vms.slowInput';
const SHOW_HIST_KEY = 'vms.showHistogram';

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

/** ゆっくり入力モード（認識断片を連結してまとめて確定）。既定: 無効 */
export function getSlowInput(): boolean {
  return localStorage.getItem(SLOW_INPUT_KEY) === '1';
}

export function setSlowInput(enabled: boolean): void {
  localStorage.setItem(SLOW_INPUT_KEY, enabled ? '1' : '0');
}

/** 工程能力のヒストグラム(グラフ)表示（既定: 表示） */
export function getShowHistogram(): boolean {
  return localStorage.getItem(SHOW_HIST_KEY) !== '0';
}

export function setShowHistogram(enabled: boolean): void {
  localStorage.setItem(SHOW_HIST_KEY, enabled ? '1' : '0');
}
