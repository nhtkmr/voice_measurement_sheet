import type { MeasureItem, Row } from './types';

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

  const bins = Math.min(10, Math.max(4, Math.ceil(Math.sqrt(values.length))));
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
  for (let i = 0; i < bins; i++) {
    const bx = (i / bins) * W;
    const bw = W / bins - 1;
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
