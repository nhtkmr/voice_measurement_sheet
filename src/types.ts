// 共通の型定義

export type ItemType = 'dimension' | 'visual' | 'angle';

/** 角度項目の表示形式（内部値は常に10進度） */
export type AngleFormat = 'decimal' | 'dms';

/** 数値として扱う項目か（寸法・角度）。目視は判定トグルのみ。 */
export function isNumericItem(type: ItemType): boolean {
  return type === 'dimension' || type === 'angle';
}

/** 測定項目（列定義） */
export interface MeasureItem {
  id: string;
  label: string; // 例: "外径A"
  type: ItemType; // 'dimension'=寸法 / 'visual'=目視 / 'angle'=角度（内部は10進度）
  nominal?: number; // 基準値
  upperTol?: number; // 上公差（基準値からの符号付き偏差、例 +0.05）
  lowerTol?: number; // 下公差（基準値からの符号付き偏差、例 -0.05）
  upper?: number; // 上限 (USL) = nominal + upperTol（公差から自動計算）
  lower?: number; // 下限 (LSL) = nominal + lowerTol（公差から自動計算）
  unit?: string; // mm 等
  decimals?: number; // 表示桁
  angleFormat?: AngleFormat; // type==='angle' のときの表示形式
}

/** 品番テンプレート */
export interface Template {
  partNo: string; // 品番（キーの一部）
  name?: string; // 品名（キーの一部）
  process?: string; // 工程（キーの一部）
  items: MeasureItem[];
}

export type Judgment = 'OK' | 'NG' | null;

/** 1本（1行）の測定値 */
export interface Row {
  values: (number | null)[]; // 列ごとの数値
  judgments: Judgment[]; // 列ごとの良否
}

/** 測定セッション */
export interface Session {
  id: string;
  partNo: string;
  name?: string;
  process?: string; // 工程（テンプレ選択状態の復元・表示用）
  label?: string; // 保存メモ（読み込み一覧での識別用、任意）
  date: string; // ISO
  items: MeasureItem[]; // セッション時点の列定義スナップショット
  rows: Row[];
}

/** 列ごとの工程能力指標 */
export interface ColumnStats {
  n: number;
  mean: number | null;
  sigma: number | null; // 標本標準偏差
  min: number | null;
  max: number | null;
  cp: number | null;
  cpk: number | null;
  ngCount: number;
}
