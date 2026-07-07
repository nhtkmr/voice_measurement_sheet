// 角度の変換・整形・解析。内部表現は常に「10進度(decimal degrees)」の数値。
// 判定/工程能力/ヒストグラムは数値のまま扱えるので、ここでは入出力の変換だけを担う。

import { parseNumber } from './voice/numberParser';

const ZEN_DIGIT = /[０-９．－ー−]/g;
const ZEN_MAP: Record<string, string> = {
  '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
  '．': '.', '－': '-', 'ー': '-', '−': '-',
};

/** 度・分・秒 → 10進度。分/秒は度の符号に従う。 */
export function dmsToDeg(d: number, m: number, s: number): number {
  const sign = d < 0 ? -1 : 1;
  const deg = Math.abs(d) + Math.abs(m) / 60 + Math.abs(s) / 3600;
  return sign * deg;
}

export interface Dms {
  d: number;
  m: number;
  s: number;
  neg: boolean;
}

/** 10進度 → 度分秒（秒は四捨五入で整数化、繰り上げ処理込み）。 */
export function degToDms(deg: number): Dms {
  const neg = deg < 0;
  let total = Math.round(Math.abs(deg) * 3600); // 秒に丸め
  const d = Math.floor(total / 3600);
  total -= d * 3600;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return { d, m, s, neg };
}

/** 10進度を表示用文字列にする。 */
export function formatAngle(deg: number, format: 'decimal' | 'dms', decimals = 3): string {
  if (deg == null || Number.isNaN(deg)) return '';
  if (format === 'dms') {
    const { d, m, s, neg } = degToDms(deg);
    return `${neg ? '-' : ''}${d}°${m}'${s}"`;
  }
  const f = 10 ** decimals;
  return String(Math.round(deg * f) / f);
}

function toHalfWidth(s: string): string {
  return s.replace(ZEN_DIGIT, (c) => ZEN_MAP[c] ?? c);
}

/**
 * 角度の入力・音声を10進度へ解釈する。解釈不可なら null。
 * 受理例:
 *  - "45度30分15秒" / "45°30'15\"" / "45 30 15"（度分秒）
 *  - "45度30分" / "45°30'"（秒省略）
 *  - "45.5" / "45点5" / "四十五点五"（小数度）
 */
export function parseAngle(raw: string): number | null {
  if (raw == null) return null;
  let s = toHalfWidth(String(raw)).trim();
  if (s === '') return null;

  // 度分秒マーカー（度/°、分/'/′、秒/"/″）を含むか
  const dm = s.match(/(-?\d+(?:\.\d+)?)\s*(?:度|°)/);
  const mm = s.match(/(\d+(?:\.\d+)?)\s*(?:分|'|′)/);
  const sm = s.match(/(\d+(?:\.\d+)?)\s*(?:秒|"|″)/);
  if (dm || mm || sm) {
    const d = dm ? Number(dm[1]) : 0;
    const m = mm ? Number(mm[1]) : 0;
    const sec = sm ? Number(sm[1]) : 0;
    if ([d, m, sec].some((n) => Number.isNaN(n))) return null;
    return dmsToDeg(d, m, sec);
  }

  // 空白/記号区切りの "45 30 15"（2〜3個の数値）を度分秒とみなす
  const parts = s.split(/[\s:]+/).filter(Boolean);
  if (parts.length >= 2 && parts.length <= 3 && parts.every((p) => /^-?\d+(?:\.\d+)?$/.test(p))) {
    const [d, m, sec = '0'] = parts;
    return dmsToDeg(Number(d), Number(m), Number(sec));
  }

  // 単一の数値は小数度として解釈（漢数字・"点"表記も numberParser に委譲）
  return parseNumber(s);
}
