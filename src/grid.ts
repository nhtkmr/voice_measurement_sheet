import type { Session, MeasureItem } from './types';
import { isNumericItem } from './types';
import { toleranceLabel } from './format';
import { formatAngle } from './angle';

/** 保存値(数値)をセル表示用文字列にする。角度は形式に整形、寸法はそのまま。 */
export function displayValue(it: MeasureItem, v: number | null): string {
  if (v == null || Number.isNaN(v)) return '';
  if (it.type === 'angle') return formatAngle(v, it.angleFormat ?? 'decimal', it.decimals ?? 3);
  return String(v);
}

export interface GridCallbacks {
  onValueInput: (row: number, col: number, raw: string) => void;
  onCellFocus: (row: number, col: number) => void;
  onVisualToggle: (row: number, col: number) => void;
  onDeleteRow: (row: number) => void;
}

export interface ActiveCell {
  row: number;
  col: number;
}

/**
 * 測定グリッドを描画する。行=測定本数、列=各項目(寸法値+判定)。
 * 値セルは常に <input> で手入力も可能。判定は寸法=自動色分け / 目視=トグル。
 */
export function renderGrid(
  container: HTMLElement,
  session: Session,
  active: ActiveCell,
  cb: GridCallbacks
): void {
  const table = document.createElement('table');
  table.className = 'grid';

  // ヘッダ
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  hr.appendChild(th('No.'));
  for (const it of session.items) {
    const tol = it.type === 'visual' ? '目視' : toleranceLabel(it);
    const cell = th(`${it.label}${it.unit ? ` (${it.unit})` : ''}`);
    const small = document.createElement('div');
    small.className = 'tol';
    small.textContent = tol;
    cell.appendChild(small);
    cell.colSpan = 2;
    hr.appendChild(cell);
  }
  hr.appendChild(th(''));
  thead.appendChild(hr);
  table.appendChild(thead);

  // 本体
  const tbody = document.createElement('tbody');
  session.rows.forEach((row, r) => {
    const tr = document.createElement('tr');
    const no = document.createElement('td');
    no.className = 'rownum';
    no.textContent = String(r + 1);
    tr.appendChild(no);

    session.items.forEach((it, c) => {
      // 値セル
      const vtd = document.createElement('td');
      vtd.className = 'valcell';
      if (isNumericItem(it.type)) {
        const input = document.createElement('input');
        input.type = 'text';
        input.inputMode = it.type === 'angle' && it.angleFormat === 'dms' ? 'text' : 'decimal';
        input.value = displayValue(it, row.values[c]);
        input.dataset.row = String(r);
        input.dataset.col = String(c);
        if (active.row === r && active.col === c) input.classList.add('active');
        input.addEventListener('focus', () => cb.onCellFocus(r, c));
        input.addEventListener('change', () => cb.onValueInput(r, c, input.value));
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            cb.onValueInput(r, c, input.value);
          }
        });
        vtd.appendChild(input);
      } else {
        vtd.textContent = '—';
        vtd.classList.add('muted');
      }
      tr.appendChild(vtd);

      // 判定セル
      const jtd = document.createElement('td');
      jtd.className = 'judgecell';
      const j = row.judgments[c];
      if (it.type === 'visual') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'judge-btn ' + (j ? j.toLowerCase() : 'none');
        btn.textContent = j ?? '—';
        btn.addEventListener('click', () => cb.onVisualToggle(r, c));
        jtd.appendChild(btn);
      } else {
        jtd.textContent = j ?? '';
        if (j) jtd.classList.add(j.toLowerCase());
      }
      tr.appendChild(jtd);
    });

    // 行削除
    const dtd = document.createElement('td');
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'row-del';
    del.textContent = '×';
    del.title = 'この行を削除';
    del.addEventListener('click', () => cb.onDeleteRow(r));
    dtd.appendChild(del);
    tr.appendChild(dtd);

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  container.replaceChildren(table);

  // アクティブセルにフォーカス
  const activeInput = container.querySelector<HTMLInputElement>(
    `input[data-row="${active.row}"][data-col="${active.col}"]`
  );
  if (activeInput && document.activeElement !== activeInput) {
    activeInput.focus();
    activeInput.select();
  }
}

function th(text: string): HTMLTableCellElement {
  const el = document.createElement('th');
  el.textContent = text;
  return el;
}
