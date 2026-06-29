import * as XLSX from 'xlsx';
import type { Session } from './types';
import { columnStats } from './stats';
import { toleranceLabel } from './format';

/**
 * セッションを .xlsx として出力（ダウンロード）。
 * - シート1「測定表」: 行=測定本数、列=寸法/判定。ヘッダに品番・公差。
 * - シート2「工程能力」: 各項目の n / x̄ / σ / Cp / Cpk / NG数。
 * 注: 標準のSheetJS(無償版)はセル背景色の書込に未対応のため、
 *     NGは判定列の "NG" 文字で表現する。
 */
export function exportSession(session: Session): void {
  const wb = XLSX.utils.book_new();

  // ---- シート1: 測定表 ----
  const aoa: (string | number | null)[][] = [];
  aoa.push([`品番: ${session.partNo}`, session.name ?? '', `日付: ${session.date.slice(0, 10)}`]);

  // 列ヘッダ（寸法 + 判定）
  const header: string[] = ['No.'];
  const subHeader: string[] = [''];
  for (const it of session.items) {
    header.push(it.label + (it.unit ? `(${it.unit})` : ''));
    header.push('判定');
    subHeader.push(toleranceLabel(it));
    subHeader.push('');
  }
  aoa.push(header);
  aoa.push(subHeader);

  session.rows.forEach((row, i) => {
    const line: (string | number | null)[] = [i + 1];
    session.items.forEach((_, c) => {
      line.push(row.values[c] ?? null);
      line.push(row.judgments[c] ?? '');
    });
    aoa.push(line);
  });

  const ws1 = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws1, '測定表');

  // ---- シート2: 工程能力 ----
  const cap: (string | number | null)[][] = [
    ['測定項目', '下限', '上限', 'n', '平均', 'σ', 'Cp', 'Cpk', 'NG数'],
  ];
  session.items.forEach((it, c) => {
    const s = columnStats(it, session.rows, c);
    cap.push([
      it.label,
      it.lower ?? '',
      it.upper ?? '',
      s.n,
      round(s.mean),
      round(s.sigma, 4),
      round(s.cp, 3),
      round(s.cpk, 3),
      s.ngCount,
    ]);
  });
  const ws2 = XLSX.utils.aoa_to_sheet(cap);
  XLSX.utils.book_append_sheet(wb, ws2, '工程能力');

  const fname = `測定_${session.partNo}_${session.date.slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, fname);
}

function round(v: number | null, digits = 3): number | string {
  if (v == null || Number.isNaN(v)) return '';
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
