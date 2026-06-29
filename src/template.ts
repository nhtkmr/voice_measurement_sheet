import type { Template, MeasureItem } from './types';

const KEY = 'vms.templates';

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

/** 全テンプレートを読み込む（品番キーのマップ） */
export function loadTemplates(): Record<string, Template> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as Record<string, Template>;
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

export function listTemplates(): Template[] {
  return Object.values(loadTemplates()).sort((a, b) =>
    a.partNo.localeCompare(b.partNo)
  );
}

export function getTemplate(partNo: string): Template | undefined {
  return loadTemplates()[partNo];
}

/** テンプレートを保存（品番をキーに upsert） */
export function saveTemplate(tpl: Template): void {
  const all = loadTemplates();
  all[tpl.partNo] = tpl;
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function deleteTemplate(partNo: string): void {
  const all = loadTemplates();
  delete all[partNo];
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
      const type = r.type === 'visual' ? 'visual' : 'dimension';
      const num = (v: unknown) => (typeof v === 'number' && !Number.isNaN(v) ? v : undefined);
      const item: MeasureItem = {
        id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
        label: r.label,
        type,
        nominal: num(r.nominal),
        upperTol: num(r.upperTol),
        lowerTol: num(r.lowerTol),
        unit: typeof r.unit === 'string' ? r.unit : undefined,
        decimals: num(r.decimals),
      };
      return type === 'dimension' ? applyTolerance(item) : item;
    })
    .filter((i): i is MeasureItem => i !== null);
  return {
    partNo: o.partNo.trim(),
    name: typeof o.name === 'string' ? o.name : undefined,
    items,
  };
}

/**
 * JSON文字列からテンプレートを取り込む。
 * 受理形式: {templates:[...]} / 配列 / 品番キーのマップ。
 * mode='merge'(既定): 既存に追記・同一品番は上書き / 'replace': 全置換。
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
    if (store[t.partNo]) updated++;
    else added++;
    store[t.partNo] = t;
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
