import type { Template, Session, MeasureItem, Row } from './types';
import {
  listTemplates,
  getTemplate,
  saveTemplate,
  deleteTemplate,
  sampleTemplate,
  loadTemplates,
  applyTolerance,
  exportTemplatesJson,
  importTemplatesJson,
} from './template';
import { renderGrid, type ActiveCell } from './grid';
import { judgeDimension } from './judge';
import { columnStats, cpkLevelColor } from './stats';
import { drawHistogram } from './histogram';
import { parseNumber, parseCommand } from './voice/numberParser';
import {
  Recognizer,
  isVoiceSupported,
  speak,
  beep,
} from './voice/recognizer';
import { exportSession } from './exportXlsx';
import {
  saveSession,
  getSession,
  getCurrentSessionId,
  listSessions,
  deleteSession,
} from './store';
import { getNgVoice, setNgVoice, getAdvanceDir, setAdvanceDir, type AdvanceDir } from './settings';

/** NG発生時のフィードバック。ビープは常時、「NGです」は設定ON時のみ。 */
function announceNG(): void {
  beep();
  if (getNgVoice()) speak('NGです');
}

interface AppState {
  templates: Record<string, Template>;
  session: Session;
  active: ActiveCell;
}

const $ = <T extends HTMLElement>(sel: string) =>
  document.querySelector(sel) as T;

const els = {
  partSelect: $('#partSelect') as HTMLSelectElement,
  newBtn: $('#newBtn') as HTMLButtonElement,
  saveBtn: $('#saveBtn') as HTMLButtonElement,
  loadBtn: $('#loadBtn') as HTMLButtonElement,
  newDialog: $('#newDialog') as HTMLDialogElement,
  loadDialog: $('#loadDialog') as HTMLDialogElement,
  loadList: $('#loadList') as HTMLElement,
  loadClose: $('#loadClose') as HTMLButtonElement,
  tplBtn: $('#tplBtn') as HTMLButtonElement,
  tplExportBtn: $('#tplExportBtn') as HTMLButtonElement,
  tplImportBtn: $('#tplImportBtn') as HTMLButtonElement,
  tplFile: $('#tplFile') as HTMLInputElement,
  ngVoiceChk: $('#ngVoiceChk') as HTMLInputElement,
  rowCount: $('#rowCount') as HTMLInputElement,
  advanceDir: $('#advanceDir') as HTMLSelectElement,
  voiceBtn: $('#voiceBtn') as HTMLButtonElement,
  addRowBtn: $('#addRowBtn') as HTMLButtonElement,
  exportBtn: $('#exportBtn') as HTMLButtonElement,
  voiceStatus: $('#voiceStatus') as HTMLElement,
  transcript: $('#transcript') as HTMLElement,
  grid: $('#grid') as HTMLElement,
  stats: $('#stats') as HTMLElement,
  tplDialog: $('#tplDialog') as HTMLDialogElement,
};

let state: AppState;
let recognizer: Recognizer | null = null;

// ---------- セッション生成 ----------
function emptyRow(items: MeasureItem[]): Row {
  return {
    values: items.map(() => null),
    judgments: items.map(() => null),
  };
}

function newSessionFromTemplate(tpl: Template, rowCount = 5): Session {
  const items = tpl.items.map((i) => ({ ...i }));
  return {
    id: crypto.randomUUID(),
    partNo: tpl.partNo,
    name: tpl.name,
    date: new Date().toISOString(),
    items,
    rows: Array.from({ length: rowCount }, () => emptyRow(items)),
  };
}

// ---------- 描画 ----------
function render(): void {
  renderGrid(els.grid, state.session, state.active, {
    onValueInput: setValue,
    onCellFocus: (r, c) => {
      state.active = { row: r, col: c };
    },
    onVisualToggle: toggleVisual,
    onDeleteRow: deleteRow,
  });
  renderStats();
  els.rowCount.value = String(state.session.rows.length); // 本数入力と同期
}

function renderStats(): void {
  const { items, rows } = state.session;
  els.stats.replaceChildren();
  items.forEach((it, c) => {
    const card = document.createElement('div');
    card.className = 'stat-card';

    const title = document.createElement('div');
    title.className = 'stat-title';
    title.textContent = it.label;
    card.appendChild(title);

    if (it.type === 'dimension') {
      const s = columnStats(it, rows, c);
      const grid = document.createElement('div');
      grid.className = 'stat-grid';
      grid.innerHTML = `
        <span>n</span><b>${s.n}</b>
        <span>平均</span><b>${fmt(s.mean)}</b>
        <span>σ</span><b>${fmt(s.sigma, 4)}</b>
        <span>Cp</span><b>${fmt(s.cp, 2)}</b>
        <span>Cpk</span><b style="color:${cpkLevelColor(s.cpk)}">${fmt(s.cpk, 2)}</b>
        <span>NG</span><b>${s.ngCount}</b>`;
      card.appendChild(grid);

      const canvas = document.createElement('canvas');
      canvas.width = 240;
      canvas.height = 90;
      canvas.className = 'hist';
      card.appendChild(canvas);
      drawHistogram(canvas, it, rows, c);
    } else {
      let ng = 0;
      let ok = 0;
      rows.forEach((r) => {
        if (r.judgments[c] === 'NG') ng++;
        else if (r.judgments[c] === 'OK') ok++;
      });
      const grid = document.createElement('div');
      grid.className = 'stat-grid';
      grid.innerHTML = `<span>目視</span><b>—</b><span>OK</span><b>${ok}</b><span>NG</span><b>${ng}</b>`;
      card.appendChild(grid);
    }
    els.stats.appendChild(card);
  });
}

function fmt(v: number | null, digits = 3): string {
  if (v == null || Number.isNaN(v)) return '—';
  const f = 10 ** digits;
  return String(Math.round(v * f) / f);
}

// ---------- 値・判定の更新 ----------
function setValue(row: number, col: number, raw: string): void {
  const item = state.session.items[col];
  const r = state.session.rows[row];
  const trimmed = raw.trim();
  if (trimmed === '') {
    r.values[col] = null;
    r.judgments[col] = null;
  } else {
    const num = parseNumber(trimmed);
    if (num == null) {
      // 解釈不可: 表示だけ戻す
      render();
      return;
    }
    r.values[col] = num;
    if (item.type === 'dimension') {
      const j = judgeDimension(item, num);
      r.judgments[col] = j;
      if (j === 'NG') announceNG();
    }
  }
  autosave();
  render();
}

function toggleVisual(row: number, col: number): void {
  const r = state.session.rows[row];
  const cur = r.judgments[col];
  r.judgments[col] = cur === 'OK' ? 'NG' : cur === 'NG' ? null : 'OK';
  if (r.judgments[col] === 'NG') announceNG();
  autosave();
  render();
}

function deleteRow(row: number): void {
  if (state.session.rows.length <= 1) return;
  state.session.rows.splice(row, 1);
  if (state.active.row >= state.session.rows.length) {
    state.active.row = state.session.rows.length - 1;
  }
  autosave();
  render();
}

function addRow(): void {
  state.session.rows.push(emptyRow(state.session.items));
  autosave();
  render();
}

/** 測定本数(行数)を任意の数に設定する。入力データのある行を削る場合は確認。 */
function setRowCount(n: number): void {
  const target = Math.max(1, Math.min(999, Math.floor(n)));
  const rows = state.session.rows;
  if (!Number.isFinite(target) || target === rows.length) {
    els.rowCount.value = String(rows.length);
    return;
  }
  if (target < rows.length) {
    const removed = rows.slice(target);
    const hasData = removed.some(
      (r) => r.values.some((v) => v != null) || r.judgments.some((j) => j != null)
    );
    if (
      hasData &&
      !confirm(`本数を${target}に減らすと、${rows.length - target}本ぶんの入力データが削除されます。よろしいですか？`)
    ) {
      els.rowCount.value = String(rows.length);
      return;
    }
    rows.length = target;
    if (state.active.row >= target) state.active.row = target - 1;
  } else {
    while (rows.length < target) rows.push(emptyRow(state.session.items));
  }
  autosave();
  render();
}

// ---------- ナビゲーション ----------
// 進む方向を切替: 'item'=項目方向(横,列送り) / 'row'=No.方向(縦,行送り)
function moveNext(): void {
  let { row, col } = state.active;
  const nCols = state.session.items.length;
  if (getAdvanceDir() === 'item') {
    col++;
    if (col >= nCols) {
      col = 0;
      row++;
      if (row >= state.session.rows.length) addRow(); // 次の1本へ自動追加
    }
  } else {
    row++;
    if (row >= state.session.rows.length) {
      row = 0;
      col = (col + 1) % nCols; // 次の項目の先頭へ
    }
  }
  state.active = { row, col };
  render();
}

function movePrev(): void {
  let { row, col } = state.active;
  const nCols = state.session.items.length;
  if (getAdvanceDir() === 'item') {
    col--;
    if (col < 0) {
      if (row > 0) {
        row--;
        col = nCols - 1;
      } else {
        col = 0;
      }
    }
  } else {
    row--;
    if (row < 0) {
      if (col > 0) {
        col--;
        row = state.session.rows.length - 1;
      } else {
        row = 0;
      }
    }
  }
  state.active = { row, col };
  render();
}

// ---------- 音声 ----------
function handleVoiceFinal(text: string): void {
  els.transcript.textContent = text;
  const { row, col } = state.active;
  const item = state.session.items[col];

  const cmd = parseCommand(text);
  if (cmd === 'next' || cmd === 'confirm') return moveNext();
  if (cmd === 'prev') return movePrev();
  if (cmd === 'undo') {
    setValue(row, col, '');
    return;
  }
  if (cmd === 'ok' || cmd === 'ng') {
    if (item.type === 'visual') {
      const j = cmd === 'ok' ? 'OK' : 'NG';
      state.session.rows[row].judgments[col] = j;
      if (j === 'NG') announceNG();
      autosave();
      // NGは測り直しのため進めず、その場に留める
      if (j === 'NG') render();
      else moveNext();
    }
    return;
  }

  // 数値として解釈（寸法セルのみ）
  if (item.type === 'dimension') {
    const num = parseNumber(text);
    if (num != null) {
      setValue(row, col, String(num));
      // NGは測り直しのため進めず、その場に留める
      if (state.session.rows[row].judgments[col] !== 'NG') moveNext();
    }
  }
}

function toggleVoice(): void {
  if (!isVoiceSupported()) {
    els.voiceStatus.textContent = '音声非対応(Edge/Chrome推奨)';
    return;
  }
  if (!recognizer) {
    recognizer = new Recognizer({
      onResult: (t, isFinal) => {
        if (isFinal) handleVoiceFinal(t.trim());
        else els.transcript.textContent = '… ' + t;
      },
      onError: (m) => {
        els.voiceStatus.textContent = m;
      },
      onStateChange: (listening) => {
        els.voiceBtn.classList.toggle('on', listening);
        els.voiceBtn.textContent = listening ? '⏹ 音声停止' : '🎤 音声開始';
        els.voiceStatus.textContent = listening ? '認識中…' : '待機中';
      },
    });
  }
  if (recognizer.listening) recognizer.stop();
  else recognizer.start();
}

// ---------- 自動保存 ----------
let saveTimer: number | undefined;
function autosave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void saveSession(state.session);
  }, 400);
}

/** 保留中の自動保存を取り消し、現在のセッションを即時保存する。 */
function flushSave(): Promise<void> {
  window.clearTimeout(saveTimer);
  return saveSession(state.session);
}

/** セッションに測定データ（値または判定）が入っているか */
function sessionHasData(s: Session): boolean {
  return s.rows.some(
    (r) => r.values.some((v) => v != null) || r.judgments.some((j) => j != null)
  );
}

/** 選択中の品番テンプレと本数で新規セッションを開始する。 */
async function startNewSession(): Promise<void> {
  const tpl = getTemplate(els.partSelect.value);
  if (!tpl) return;
  const count = Math.max(1, Math.min(999, Math.floor(Number(els.rowCount.value) || 5)));
  window.clearTimeout(saveTimer);
  state.session = newSessionFromTemplate(tpl, count);
  state.active = { row: 0, col: 0 };
  await saveSession(state.session);
  render();
}

// ---------- 途中保存 / 読み込み ----------
async function saveCurrent(): Promise<void> {
  const memo = prompt('保存メモ（任意・空欄可）', state.session.label ?? '');
  if (memo !== null) state.session.label = memo.trim() || undefined;
  await flushSave();
  els.voiceStatus.textContent = '保存しました';
}

async function openLoadDialog(): Promise<void> {
  const sessions = await listSessions();
  els.loadList.replaceChildren();
  if (sessions.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = '保存データはありません';
    els.loadList.appendChild(empty);
  } else {
    for (const s of sessions) {
      const ng = s.rows.reduce(
        (a, r) => a + r.judgments.filter((j) => j === 'NG').length,
        0
      );
      const when = s.date.replace('T', ' ').slice(0, 16);
      const editing = s.id === state.session.id ? ' ・編集中' : '';

      const rowEl = document.createElement('div');
      rowEl.className = 'load-row';
      const info = document.createElement('div');
      info.className = 'load-info';
      info.innerHTML =
        `<b>${esc(s.label || s.partNo)}</b>` +
        `<span>${esc(s.partNo)} / ${when} / ${s.rows.length}本 / NG ${ng}${editing}</span>`;

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'primary';
      openBtn.textContent = '開く';
      openBtn.addEventListener('click', () => void loadSessionById(s.id));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'danger';
      delBtn.textContent = '削除';
      delBtn.addEventListener('click', async () => {
        if (confirm('この保存データを削除しますか？')) {
          await deleteSession(s.id);
          await openLoadDialog(); // 一覧を再描画
        }
      });

      rowEl.append(info, openBtn, delBtn);
      els.loadList.appendChild(rowEl);
    }
  }
  els.loadDialog.showModal();
}

async function loadSessionById(id: string): Promise<void> {
  await flushSave(); // 現在の編集内容を確実に保存してから切替（消失防止）
  const s = await getSession(id);
  if (!s) return;
  state.session = s;
  state.active = { row: 0, col: 0 };
  await saveSession(s); // 復元時の「現在のセッション」として設定
  els.loadDialog.close();
  render();
}

// ---------- 品番セレクト ----------
function refreshPartSelect(): void {
  const tpls = listTemplates();
  els.partSelect.replaceChildren();
  for (const t of tpls) {
    const opt = document.createElement('option');
    opt.value = t.partNo;
    opt.textContent = t.name ? `${t.partNo} (${t.name})` : t.partNo;
    if (t.partNo === state.session.partNo) opt.selected = true;
    els.partSelect.appendChild(opt);
  }
}

// ---------- テンプレ編集ダイアログ ----------
function openTemplateEditor(partNo?: string): void {
  const tpl: Template = partNo
    ? getTemplate(partNo) ?? { partNo: '', items: [] }
    : { partNo: '', items: [{ id: crypto.randomUUID(), label: '', type: 'dimension', decimals: 2 }] };

  ($('#tplPartNo') as HTMLInputElement).value = tpl.partNo;
  ($('#tplName') as HTMLInputElement).value = tpl.name ?? '';
  const itemsTable = $('#tplItems') as HTMLTableElement;

  const renderItems = (items: MeasureItem[]) => {
    itemsTable.replaceChildren();
    const head = document.createElement('tr');
    head.innerHTML =
      '<th>項目名</th><th>種別</th><th>基準値</th><th>上公差</th><th>下公差</th><th>単位</th><th></th>';
    itemsTable.appendChild(head);
    items.forEach((it, i) => {
      // 旧データ(上限/下限のみ)も公差表示できるよう、必要なら基準値から導出
      const derive = (limit?: number) =>
        it.nominal != null && limit != null
          ? Math.round((limit - it.nominal) * 1e6) / 1e6
          : '';
      const upperTol = it.upperTol ?? derive(it.upper);
      const lowerTol = it.lowerTol ?? derive(it.lower);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input class="i-label" value="${esc(it.label)}" /></td>
        <td><select class="i-type">
          <option value="dimension"${it.type === 'dimension' ? ' selected' : ''}>寸法</option>
          <option value="visual"${it.type === 'visual' ? ' selected' : ''}>目視</option>
        </select></td>
        <td><input class="i-nominal num" value="${it.nominal ?? ''}" /></td>
        <td><input class="i-upperTol num" value="${upperTol}" placeholder="+0.05" /></td>
        <td><input class="i-lowerTol num" value="${lowerTol}" placeholder="-0.05" /></td>
        <td><input class="i-unit unit" value="${esc(it.unit ?? '')}" /></td>
        <td><button type="button" class="i-del" data-i="${i}">×</button></td>`;
      itemsTable.appendChild(tr);
    });
    itemsTable.querySelectorAll<HTMLButtonElement>('.i-del').forEach((b) =>
      b.addEventListener('click', () => {
        const cur = collectItems();
        cur.splice(Number(b.dataset.i), 1);
        renderItems(cur);
      })
    );
  };

  const collectItems = (): MeasureItem[] => {
    const rows = Array.from(itemsTable.querySelectorAll('tr')).slice(1);
    return rows.map((tr) => {
      const g = (s: string) => (tr.querySelector(s) as HTMLInputElement)?.value ?? '';
      const type = (tr.querySelector('.i-type') as HTMLSelectElement).value as
        | 'dimension'
        | 'visual';
      const numOrU = (v: string) => (v.trim() === '' ? undefined : Number(v));
      // 基準値＋上下公差から上限/下限を自動計算
      return applyTolerance({
        id: crypto.randomUUID(),
        label: g('.i-label').trim(),
        type,
        nominal: numOrU(g('.i-nominal')),
        upperTol: numOrU(g('.i-upperTol')),
        lowerTol: numOrU(g('.i-lowerTol')),
        unit: g('.i-unit').trim() || undefined,
        decimals: 2,
      } as MeasureItem);
    });
  };

  renderItems(tpl.items);

  const addBtn = $('#tplAddItem') as HTMLButtonElement;
  addBtn.onclick = () => {
    const cur = collectItems();
    cur.push({ id: crypto.randomUUID(), label: '', type: 'dimension', decimals: 2 });
    renderItems(cur);
  };

  const form = $('#tplForm') as HTMLFormElement;
  form.onsubmit = (e) => {
    const action = (e.submitter as HTMLButtonElement)?.value;
    if (action === 'save') {
      const partNoVal = ($('#tplPartNo') as HTMLInputElement).value.trim();
      if (!partNoVal) {
        e.preventDefault();
        return;
      }
      const newTpl: Template = {
        partNo: partNoVal,
        name: ($('#tplName') as HTMLInputElement).value.trim() || undefined,
        items: collectItems().filter((i) => i.label !== ''),
      };
      saveTemplate(newTpl);
      refreshPartSelect();
      // 編集中の品番が現在のセッションなら反映を促す（新規測定で適用）
    } else if (action === 'delete') {
      const partNoVal = ($('#tplPartNo') as HTMLInputElement).value.trim();
      if (partNoVal && confirm(`テンプレ「${partNoVal}」を削除しますか？`)) {
        deleteTemplate(partNoVal);
        refreshPartSelect();
      } else {
        e.preventDefault();
      }
    }
    els.tplDialog.close();
  };

  els.tplDialog.showModal();
}

function esc(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ---------- テンプレ JSON 書出/取込 ----------
function exportTemplates(): void {
  const json = exportTemplatesJson();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `templates_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importTemplatesFromFile(file: File): Promise<void> {
  try {
    const text = await file.text();
    // 既存があれば追記(merge)か全置換(replace)かを確認
    let mode: 'merge' | 'replace' = 'merge';
    if (Object.keys(loadTemplates()).length > 0) {
      mode = confirm(
        '既存のテンプレートに「追記/上書き」しますか？\n' +
          '［OK］追記（同一品番は上書き） ／ ［キャンセル］全置換'
      )
        ? 'merge'
        : 'replace';
    }
    const res = importTemplatesJson(text, mode);
    refreshPartSelect();
    els.voiceStatus.textContent = `テンプレ取込: 新規${res.added}件 / 更新${res.updated}件（${mode === 'replace' ? '全置換' : '追記'}）`;
  } catch (e) {
    alert('取込に失敗しました: ' + (e as Error).message);
  }
}

// ---------- 初期化 ----------
async function init(): Promise<void> {
  state = {
    templates: loadTemplates(),
    session: null as unknown as Session,
    active: { row: 0, col: 0 },
  };

  // テンプレが無ければサンプルを投入
  if (Object.keys(state.templates).length === 0) {
    saveTemplate(sampleTemplate());
    state.templates = loadTemplates();
  }

  // 直近セッションの復元、無ければ先頭テンプレで新規
  const lastId = getCurrentSessionId();
  let restored: Session | undefined;
  if (lastId) restored = await getSession(lastId);
  if (restored) {
    state.session = restored;
  } else {
    const first = listTemplates()[0];
    state.session = newSessionFromTemplate(first);
    await saveSession(state.session);
  }

  refreshPartSelect();
  render();

  // イベント
  els.newBtn.addEventListener('click', () => {
    // データがあれば保存/破棄/中止を確認、無ければそのまま新規
    if (sessionHasData(state.session)) els.newDialog.showModal();
    else void startNewSession();
  });
  els.newDialog.addEventListener('close', () => {
    const v = els.newDialog.returnValue;
    if (v === 'save') {
      void flushSave().then(startNewSession);
    } else if (v === 'discard') {
      window.clearTimeout(saveTimer);
      void deleteSession(state.session.id).then(startNewSession);
    }
    // cancel / その他: 何もしない
  });
  els.saveBtn.addEventListener('click', () => void saveCurrent());
  els.loadBtn.addEventListener('click', () => void openLoadDialog());
  els.loadClose.addEventListener('click', () => els.loadDialog.close());
  els.partSelect.addEventListener('change', () => {
    // 選択しただけでは切替えない（新規測定ボタンで適用）。プレビュー用に通知。
    els.voiceStatus.textContent = `「新規測定」で ${els.partSelect.value} を適用`;
  });
  els.tplBtn.addEventListener('click', () => openTemplateEditor(els.partSelect.value));
  els.tplExportBtn.addEventListener('click', exportTemplates);
  els.tplImportBtn.addEventListener('click', () => els.tplFile.click());
  els.tplFile.addEventListener('change', () => {
    const f = els.tplFile.files?.[0];
    if (f) void importTemplatesFromFile(f);
    els.tplFile.value = ''; // 同じファイルを連続選択できるようリセット
  });
  els.addRowBtn.addEventListener('click', addRow);
  els.rowCount.addEventListener('change', () => setRowCount(Number(els.rowCount.value)));
  els.advanceDir.value = getAdvanceDir();
  els.advanceDir.addEventListener('change', () => setAdvanceDir(els.advanceDir.value as AdvanceDir));
  els.voiceBtn.addEventListener('click', toggleVoice);
  els.ngVoiceChk.checked = getNgVoice();
  els.ngVoiceChk.addEventListener('change', () => setNgVoice(els.ngVoiceChk.checked));
  els.exportBtn.addEventListener('click', () => exportSession(state.session));

  if (!isVoiceSupported()) {
    els.voiceBtn.disabled = true;
    els.voiceBtn.textContent = '🎤 音声非対応';
    els.voiceStatus.textContent = 'このブラウザは音声非対応(Edge/Chrome推奨)。手入力で利用可。';
  }
}

void init();
