import type { Template, MeasureItem, ItemType } from './types';
import { isNumericItem } from './types';

const KEY = 'vms.templates';

/** 複合キーの区切り（通常入力されない制御文字 U+241F / UNIT SEPARATOR） */
const SEP = '␟';

/** 品番＋品名＋工程からテンプレートの識別キーを生成する */
export function templateKey(t: { partNo: string; name?: string; process?: string }): string {
  return `${t.partNo}${SEP}${t.name ?? ''}${SEP}${t.process ?? ''}`;
}

/** 浮動小数の桁ノイズを抑える丸め */
function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/**
 * 基準値＋上下公差から上限(USL)/下限(LSL)を計算し、item に反映して返す。
 * 公差や基準値が無い側は undefined のまま。
 */
export function applyTolerance(item: MeasureItem): MeasureItem {
  const { nominal, upperTol, lowerTol } = item;
  return {
    ...item,
    upper: nominal != null && upperTol != null ? round6(nominal + upperTol) : undefined,
    lower: nominal != null && lowerTol != null ? round6(nominal + lowerTol) : undefined,
  };
}

/**
 * 全テンプレートを読み込む（複合キー 品番␟品名␟工程 のマップ）。
 * 保存キーは無視して各値から再計算するため、旧形式（品番キー・工程なし）も
 * 自動的に新キーへ移行される。
 */
export function loadTemplates(): Record<string, Template> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as Record<string, Template>;
    if (!obj || typeof obj !== 'object') return {};
    const map: Record<string, Template> = {};
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object' && typeof v.partNo === 'string') {
        map[templateKey(v)] = v;
      }
    }
    return map;
  } catch {
    return {};
  }
}

export function listTemplates(): Template[] {
  return Object.values(loadTemplates()).sort(
    (a, b) =>
      a.partNo.localeCompare(b.partNo) ||
      (a.name ?? '').localeCompare(b.name ?? '') ||
      (a.process ?? '').localeCompare(b.process ?? '')
  );
}

export function getTemplate(key: string): Template | undefined {
  return loadTemplates()[key];
}

/** テンプレートを保存（品番␟品名␟工程 をキーに upsert） */
export function saveTemplate(tpl: Template): void {
  const all = loadTemplates();
  all[templateKey(tpl)] = tpl;
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function deleteTemplate(key: string): void {
  const all = loadTemplates();
  delete all[key];
  localStorage.setItem(KEY, JSON.stringify(all));
}

// ---------- JSON 書き出し / 取り込み ----------

const SCHEMA = 'vms.templates';

/** 全テンプレートをJSON文字列にする（ファイル書き出し用） */
export function exportTemplatesJson(): string {
  return JSON.stringify(
    { schema: SCHEMA, version: 1, exportedAt: new Date().toISOString(), templates: listTemplates() },
    null,
    2
  );
}

export interface ImportResult {
  added: number;
  updated: number;
  total: number;
}

/** 取り込んだ生データを検証し、上限/下限を再計算して正規化 */
function sanitizeTemplate(t: unknown): Template | null {
  if (!t || typeof t !== 'object') return null;
  const o = t as Record<string, unknown>;
  if (typeof o.partNo !== 'string' || o.partNo.trim() === '') return null;
  if (!Array.isArray(o.items)) return null;
  const items: MeasureItem[] = (o.items as unknown[])
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null;
      const r = raw as Record<string, unknown>;
      if (typeof r.label !== 'string') return null;
      const type: ItemType =
        r.type === 'visual' ? 'visual' : r.type === 'angle' ? 'angle' : 'dimension';
      const num = (v: unknown) => (typeof v === 'number' && !Number.isNaN(v) ? v : undefined);
      const item: MeasureItem = {
        id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
        label: r.label,
        type,
        nominal: num(r.nominal),
        upperTol: num(r.upperTol),
        lowerTol: num(r.lowerTol),
        unit: type === 'angle' ? '°' : typeof r.unit === 'string' ? r.unit : undefined,
        decimals: num(r.decimals),
        angleFormat:
          type === 'angle' ? (r.angleFormat === 'dms' ? 'dms' : 'decimal') : undefined,
      };
      return isNumericItem(type) ? applyTolerance(item) : item;
    })
    .filter((i): i is MeasureItem => i !== null);
  return {
    partNo: o.partNo.trim(),
    name: typeof o.name === 'string' ? o.name : undefined,
    process: typeof o.process === 'string' ? o.process : undefined,
    items,
  };
}

/**
 * JSON文字列からテンプレートを取り込む。
 * 受理形式: {templates:[...]} / 配列 / 品番キーのマップ。
 * mode='merge'(既定): 既存に追記・品番+品名+工程が同一なら上書き / 'replace': 全置換。
 */
export function importTemplatesJson(json: string, mode: 'merge' | 'replace' = 'merge'): ImportResult {
  const parsed = JSON.parse(json) as unknown;
  let rawList: unknown[];
  if (Array.isArray(parsed)) {
    rawList = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    if (Array.isArray(o.templates)) rawList = o.templates;
    else rawList = Object.values(o);
  } else {
    throw new Error('JSONの形式が不正です');
  }

  const valid = rawList
    .map(sanitizeTemplate)
    .filter((t): t is Template => t !== null);
  if (valid.length === 0) throw new Error('有効なテンプレートが見つかりません');

  const store = mode === 'replace' ? {} : loadTemplates();
  let added = 0;
  let updated = 0;
  for (const t of valid) {
    const k = templateKey(t);
    if (store[k]) updated++;
    else added++;
    store[k] = t;
  }
  localStorage.setItem(KEY, JSON.stringify(store));
  return { added, updated, total: valid.length };
}

/** UI/初回向けのサンプルテンプレートを生成 */
export function sampleTemplate(): Template {
  return {
    partNo: 'SAMPLE-001',
    name: 'サンプル部品',
    items: [
      applyTolerance({ id: 'd1', label: '外径A', type: 'dimension', nominal: 10, upperTol: 0.05, lowerTol: -0.05, unit: 'mm', decimals: 2 }),
      applyTolerance({ id: 'd2', label: '全長L', type: 'dimension', nominal: 25, upperTol: 0.1, lowerTol: -0.1, unit: 'mm', decimals: 2 }),
      { id: 'v1', label: '外観キズ', type: 'visual' },
    ],
  };
}
