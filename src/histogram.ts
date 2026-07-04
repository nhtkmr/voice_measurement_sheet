import type { MeasureItem, Row } from './types';

/** 数値の小数桁数を返す（指数表記も考慮）。整数や非数は0。 */
function decimalPlaces(n: number): number {
  if (!Number.isFinite(n) || Number.isInteger(n)) return 0;
  const s = Math.abs(n).toString();
  const e = s.indexOf('e');
  if (e !== -1) {
    // 例: "1e-7" / "1.2e-7"
    const mant = s.slice(0, e);
    const dot = mant.indexOf('.');
    const mantDec = dot === -1 ? 0 : mant.length - dot - 1;
    const exp = Number(s.slice(e + 1));
    return Math.max(0, mantDec - exp);
  }
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

/**
 * ヒストグラムのビン幅を小数桁数から決める。
 * 桁数は decimals（テンプレ入力時に保持した公差の桁。"0.100"→3 も反映）を最優先。
 * decimals が無い旧データは公差・上下限の桁から推定。例: ±0.05(2桁)→0.01 / ±0.1(1桁)→0.1。
 */
export function binStepFor(item: MeasureItem): number {
  let dp: number;
  if (item.decimals != null) {
    dp = item.decimals;
  } else {
    // 旧データ向けフォールバック: 公差（無ければ上下限と基準値の差）の桁から推定
    const cands: number[] = [];
    const push = (v?: number) => {
      if (v != null && Number.isFinite(v)) cands.push(v);
    };
    const round6 = (v: number) => Math.round(v * 1e6) / 1e6; // 引き算の浮動小数ノイズ除去
    push(item.upperTol);
    push(item.lowerTol);
    if (item.upperTol == null && item.upper != null && item.nominal != null)
      push(round6(item.upper - item.nominal));
    if (item.lowerTol == null && item.lower != null && item.nominal != null)
      push(round6(item.lower - item.nominal));
    dp = cands.length > 0 ? Math.max(...cands.map(decimalPlaces)) : 2;
  }
  dp = Math.min(6, Math.max(0, dp)); // 過度な細分・浮動小数ノイズを抑制
  return 10 ** -dp;
}

/** 列の値からヒストグラムをcanvasに描画し、規格線(LSL/USL)を重ねる。 */
export function drawHistogram(
  canvas: HTMLCanvasElement,
  item: MeasureItem,
  rows: Row[],
  colIndex: number
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const values = rows
    .map((r) => r.values[colIndex])
    .filter((v): v is number => v != null && !Number.isNaN(v));

  if (values.length === 0) {
    ctx.fillStyle = '#999';
    ctx.font = '12px sans-serif';
    ctx.fillText('データなし', 8, H / 2);
    return;
  }

  // 表示範囲（公差も含める）
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (item.lower != null) lo = Math.min(lo, item.lower);
  if (item.upper != null) hi = Math.max(hi, item.upper);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;

  // 公差の桁からビン幅を決め、境界をそのグリッドに整列させる。
  // 範囲が極端に広い場合のみ、棒が潰れないよう自動でビン幅を粗くする（上限本数で制御）。
  const STEP = binStepFor(item);
  const MAX_BINS = 300;
  lo = Math.floor(lo / STEP) * STEP;
  hi = Math.ceil(hi / STEP) * STEP;
  let bins = Math.max(1, Math.round((hi - lo) / STEP));
  if (bins > MAX_BINS) bins = MAX_BINS; // フォールバック（ビン幅が公差桁より広くなる）
  const counts = new Array(bins).fill(0);
  const binW = (hi - lo) / bins;
  for (const v of values) {
    let idx = Math.floor((v - lo) / binW);
    if (idx < 0) idx = 0;
    if (idx >= bins) idx = bins - 1;
    counts[idx]++;
  }
  const maxCount = Math.max(...counts, 1);

  const plotH = H - 18;
  const x = (val: number) => ((val - lo) / (hi - lo)) * W;

  // バー
  ctx.fillStyle = '#4a90d9';
  const cell = W / bins;
  const bw = cell > 3 ? cell - 1 : Math.max(1, cell); // 細いビンでも最低1pxは描く
  for (let i = 0; i < bins; i++) {
    if (counts[i] === 0) continue;
    const bx = (i / bins) * W;
    const bh = (counts[i] / maxCount) * (plotH - 4);
    ctx.fillRect(bx, plotH - bh, bw, bh);
  }

  // 規格線
  ctx.lineWidth = 2;
  const drawLine = (val: number, color: string, label: string) => {
    const px = x(val);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, plotH);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = '10px sans-serif';
    ctx.fillText(label, Math.min(px + 2, W - 24), 10);
  };
  if (item.lower != null) drawLine(item.lower, '#c62828', 'LSL');
  if (item.upper != null) drawLine(item.upper, '#c62828', 'USL');

  // 軸ラベル
  ctx.fillStyle = '#666';
  ctx.font = '10px sans-serif';
  ctx.fillText(lo.toFixed(2), 2, H - 4);
  ctx.fillText(hi.toFixed(2), W - 34, H - 4);
}
