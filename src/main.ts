import type { Template, Session, MeasureItem, Row, ItemType, AngleFormat } from './types';
import { isNumericItem } from './types';
import { parseAngle, formatAngle, dmsToDeg, degToDms } from './angle';
import {
  listTemplates,
  getTemplate,
  saveTemplate,
  deleteTemplate,
  templateKey,
  sampleTemplate,
  loadTemplates,
  applyTolerance,
  exportTemplatesJson,
  importTemplatesJson,
  initTemplates,
} from './template';
import { renderGrid, type ActiveCell } from './grid';
import { judgeDimension } from './judge';
import { columnStats, cpkLevelColor } from './stats';
import { drawHistogram } from './histogram';
import { parseNumber, parseCommand, type VoiceCommand } from './voice/numberParser';
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
import {
  getNgVoice,
  setNgVoice,
  getAdvanceDir,
  setAdvanceDir,
  getSlowInput,
  setSlowInput,
  getShowHistogram,
  setShowHistogram,
  type AdvanceDir,
} from './settings';

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
  fileName: $('#fileName') as HTMLInputElement,
  saveBtn: $('#saveBtn') as HTMLButtonElement,
  loadBtn: $('#loadBtn') as HTMLButtonElement,
  newDialog: $('#newDialog') as HTMLDialogElement,
  loadDialog: $('#loadDialog') as HTMLDialogElement,
  loadList: $('#loadList') as HTMLElement,
  loadClose: $('#loadClose') as HTMLButtonElement,
  tplNewBtn: $('#tplNewBtn') as HTMLButtonElement,
  tplBtn: $('#tplBtn') as HTMLButtonElement,
  tplExportBtn: $('#tplExportBtn') as HTMLButtonElement,
  tplImportBtn: $('#tplImportBtn') as HTMLButtonElement,
  tplFile: $('#tplFile') as HTMLInputElement,
  ngVoiceChk: $('#ngVoiceChk') as HTMLInputElement,
  slowInputChk: $('#slowInputChk') as HTMLInputElement,
  histChk: $('#histChk') as HTMLInputElement,
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

// ゆっくり入力モード用: 認識断片を連結する保留バッファと無音確定タイマー
let pendingBuf = '';
let commitTimer: number | undefined;
const SLOW_COMMIT_MS = 1200; // 無音→自動確定までの猶予（容易に調整可）

/** 保留バッファと無音タイマーを破棄する。 */
function resetPending(): void {
  pendingBuf = '';
  window.clearTimeout(commitTimer);
}

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
    process: tpl.process,
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

    if (isNumericItem(it.type)) {
      const s = columnStats(it, rows, c);
      // 角度は平均を表示形式(小数°/度分秒)に整形。σ/Cp/Cpk は数値のまま(度)。
      const meanDisp =
        it.type === 'angle' && s.mean != null
          ? formatAngle(s.mean, it.angleFormat ?? 'decimal')
          : fmt(s.mean);
      const grid = document.createElement('div');
      grid.className = 'stat-grid';
      grid.innerHTML = `
        <span>n</span><b>${s.n}</b>
        <span>平均</span><b>${meanDisp}</b>
        <span>σ</span><b>${fmt(s.sigma, 4)}</b>
        <span>Cp</span><b>${fmt(s.cp, 2)}</b>
        <span>Cpk</span><b style="color:${cpkLevelColor(s.cpk)}">${fmt(s.cpk, 2)}</b>
        <span>NG</span><b>${s.ngCount}</b>`;
      card.appendChild(grid);

      if (getShowHistogram()) {
        const canvas = document.createElement('canvas');
        canvas.width = 240;
        canvas.height = 90;
        canvas.className = 'hist';
        card.appendChild(canvas);
        drawHistogram(canvas, it, rows, c);
      }
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
    // 角度は度分秒/小数を解釈して10進度へ、それ以外は通常の数値解釈
    const num = item.type === 'angle' ? parseAngle(trimmed) : parseNumber(trimmed);
    if (num == null) {
      // 解釈不可: 表示だけ戻す
      render();
      return;
    }
    r.values[col] = num;
    if (isNumericItem(item.type)) {
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
    applyVisualJudge(cmd);
    return;
  }

  // 数値として解釈（寸法・角度セル）。角度は度分秒/小数を解釈。
  if (isNumericItem(item.type)) {
    const num = item.type === 'angle' ? parseAngle(text) : parseNumber(text);
    if (num != null) {
      setValue(row, col, String(num));
      // NGは測り直しのため進めず、その場に留める
      if (state.session.rows[row].judgments[col] !== 'NG') moveNext();
    }
  }
}

/** 目視項目のOK/NG音声判定。OKは前進、NGは測り直しのため留まる。 */
function applyVisualJudge(cmd: 'ok' | 'ng'): void {
  const { row, col } = state.active;
  if (state.session.items[col].type !== 'visual') return;
  const j = cmd === 'ok' ? 'OK' : 'NG';
  state.session.rows[row].judgments[col] = j;
  if (j === 'NG') announceNG();
  autosave();
  if (j === 'NG') render();
  else moveNext();
}

/**
 * ゆっくり入力モード: 保留バッファを現在セルへ確定する。
 * force=true は「次/確定」コマンド由来で、解釈不可/空でも前進する。
 */
function commitPending(force: boolean): void {
  const text = pendingBuf.trim();
  resetPending();
  els.transcript.textContent = text;
  const { row, col } = state.active;
  const item = state.session.items[col];
  if (text !== '' && isNumericItem(item.type)) {
    const num = item.type === 'angle' ? parseAngle(text) : parseNumber(text);
    if (num != null) {
      setValue(row, col, String(num)); // 既存: 判定・NG音・描画・autosave込み
      // NGは測り直しのため進めず、その場に留める
      if (state.session.rows[row].judgments[col] !== 'NG') moveNext();
      return;
    }
  }
  if (force) moveNext(); // 解釈不可/空でも「次」なら前進
}

/** ゆっくり入力モードでの音声コマンド処理。 */
function handleSlowCommand(cmd: VoiceCommand): void {
  if (cmd === 'next' || cmd === 'confirm') return commitPending(true);
  if (cmd === 'prev') {
    resetPending();
    return movePrev();
  }
  if (cmd === 'undo') {
    resetPending();
    return setValue(state.active.row, state.active.col, '');
  }
  // ok/ng は目視項目用
  resetPending();
  applyVisualJudge(cmd);
}

function toggleVoice(): void {
  if (!isVoiceSupported()) {
    els.voiceStatus.textContent = '音声非対応(Edge/Chrome推奨)';
    return;
  }
  if (!recognizer) {
    recognizer = new Recognizer({
      onResult: (t, isFinal) => {
        if (!getSlowInput()) {
          // 即時確定（従来動作）
          if (isFinal) handleVoiceFinal(t.trim());
          else els.transcript.textContent = '… ' + t;
          return;
        }
        // ゆっくり入力: 断片をバッファに連結し、無音/コマンドでまとめて確定
        if (!isFinal) {
          els.transcript.textContent = '… ' + (pendingBuf + t);
          return;
        }
        const frag = t.trim();
        if (frag === '') return;
        const cmd = parseCommand(frag);
        if (cmd) {
          window.clearTimeout(commitTimer);
          handleSlowCommand(cmd);
          return;
        }
        pendingBuf += frag;
        els.transcript.textContent = pendingBuf;
        window.clearTimeout(commitTimer);
        commitTimer = window.setTimeout(() => commitPending(false), SLOW_COMMIT_MS);
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
  if (recognizer.listening) {
    resetPending(); // 停止時に未確定の連結バッファを破棄
    recognizer.stop();
  } else {
    recognizer.start();
  }
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
  resetPending(); // 前測定の連結バッファ・タイマーが残らないように
  state.session = newSessionFromTemplate(tpl, count);
  state.active = { row: 0, col: 0 };
  await saveSession(state.session);
  syncFileNameField();
  render();
}

// ---------- 途中保存 / 読み込み ----------
/** ISO日時を日本時間(JST)の年月日時分に分解（ゼロ埋め済み文字列） */
function jstParts(iso: string): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
} {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

/** 保存名の既定値: 日本時間の yyyymmddhhmm */
function defaultSaveName(iso: string): string {
  const p = jstParts(iso);
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}`;
}

/** 読み込み一覧用: 日本時間の "yyyy-mm-dd hh:mm" */
function formatDateTime(iso: string): string {
  const p = jstParts(iso);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** 現在セッションの保存名を入力欄へ反映（未設定なら新規測定時の日時を既定に） */
function syncFileNameField(): void {
  els.fileName.value = state.session.label ?? defaultSaveName(state.session.date);
}

async function saveCurrent(): Promise<void> {
  state.session.label = els.fileName.value.trim() || undefined;
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
      const when = formatDateTime(s.date);
      const editing = s.id === state.session.id ? ' ・編集中' : '';

      const rowEl = document.createElement('div');
      rowEl.className = 'load-row';
      const info = document.createElement('div');
      info.className = 'load-info';
      info.innerHTML =
        `<b>${esc(s.label || defaultSaveName(s.date))}</b>` +
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
  resetPending(); // 別セッションへ切替時に連結バッファをクリア
  state.session = s;
  state.active = { row: 0, col: 0 };
  await saveSession(s); // 復元時の「現在のセッション」として設定
  els.loadDialog.close();
  syncFileNameField();
  render();
}

// ---------- 品番セレクト ----------
function refreshPartSelect(): void {
  const tpls = listTemplates();
  els.partSelect.replaceChildren();
  const curKey = templateKey(state.session);
  for (const t of tpls) {
    const opt = document.createElement('option');
    opt.value = templateKey(t);
    opt.textContent =
      t.partNo +
      (t.name ? ` / ${t.name}` : '') +
      (t.process ? ` / ${t.process}` : '');
    if (opt.value === curKey) opt.selected = true;
    els.partSelect.appendChild(opt);
  }
}

// ---------- テンプレ編集ダイアログ ----------
function openTemplateEditor(key?: string): void {
  const existing = key ? getTemplate(key) : undefined;
  const tpl: Template = existing
    ? existing
    : { partNo: '', items: [{ id: crypto.randomUUID(), label: '', type: 'dimension', decimals: 2 }] };
  // 編集元のキー（品番/品名/工程を変更して別物になった時に旧エントリを削除するため）
  const originalKey = existing ? templateKey(existing) : undefined;

  // 新規作成/編集でタイトルと「削除」ボタンを出し分け
  ($('#tplForm h2') as HTMLElement).textContent = existing
    ? '品番テンプレート編集'
    : '品番テンプレート新規作成';
  ($('#tplDelete') as HTMLButtonElement).hidden = !existing;

  ($('#tplPartNo') as HTMLInputElement).value = tpl.partNo;
  ($('#tplName') as HTMLInputElement).value = tpl.name ?? '';
  ($('#tplProcess') as HTMLInputElement).value = tpl.process ?? '';
  const itemsTable = $('#tplItems') as HTMLTableElement;

  const renderItems = (items: MeasureItem[]) => {
    itemsTable.replaceChildren();
    const head = document.createElement('tr');
    head.innerHTML =
      '<th></th><th>項目名</th><th>種別</th><th>基準値</th><th>上公差</th><th>下公差</th><th>単位</th><th></th>';
    itemsTable.appendChild(head);
    items.forEach((it) => {
      // 旧データ(上限/下限のみ)も公差表示できるよう、必要なら基準値から導出
      const derive = (limit?: number) =>
        it.nominal != null && limit != null
          ? Math.round((limit - it.nominal) * 1e6) / 1e6
          : '';
      const upperTol = it.upperTol ?? derive(it.upper);
      const lowerTol = it.lowerTol ?? derive(it.lower);
      // 保存した小数桁で整形し、末尾ゼロ(例 0.100)を保持して表示する
      const fmt = (v: number | '') =>
        v === '' || v == null ? '' : it.decimals != null ? v.toFixed(it.decimals) : String(v);

      const isAngle = it.type === 'angle';
      const af: AngleFormat = it.angleFormat ?? 'decimal';
      const isDms = isAngle && af === 'dms';

      // 種別セル（角度なら形式セレクトも表示）
      const typeCell = `<td>
        <select class="i-type">
          <option value="dimension"${it.type === 'dimension' ? ' selected' : ''}>寸法</option>
          <option value="visual"${it.type === 'visual' ? ' selected' : ''}>目視</option>
          <option value="angle"${it.type === 'angle' ? ' selected' : ''}>角度</option>
        </select>
        <select class="i-aformat"${isAngle ? '' : ' hidden'}>
          <option value="decimal"${af === 'decimal' ? ' selected' : ''}>小数°</option>
          <option value="dms"${af === 'dms' ? ' selected' : ''}>度分秒</option>
        </select>
      </td>`;

      // 基準値・公差セル（度分秒は度/分/秒の別欄で基準値/上公差/下公差、それ以外は数値欄）
      let specCells: string;
      if (isDms) {
        const nom = it.nominal != null ? degToDms(it.nominal) : null;
        const utol = it.upperTol != null ? degToDms(Math.abs(it.upperTol)) : null;
        const ltol = it.lowerTol != null ? degToDms(Math.abs(it.lowerTol)) : null;
        const v = (n?: number) => (n == null ? '' : String(n));
        specCells = `
          <td><span class="dms">
            <input class="i-nom-d numxs" value="${v(nom?.d)}" placeholder="度" />°
            <input class="i-nom-m numxs" value="${v(nom?.m)}" placeholder="分" />'
            <input class="i-nom-s numxs" value="${v(nom?.s)}" placeholder="秒" />"
          </span></td>
          <td>+<span class="dms">
            <input class="i-utol-d numxs" value="${v(utol?.d)}" />°
            <input class="i-utol-m numxs" value="${v(utol?.m)}" />'
            <input class="i-utol-s numxs" value="${v(utol?.s)}" />"
          </span></td>
          <td>−<span class="dms">
            <input class="i-ltol-d numxs" value="${v(ltol?.d)}" />°
            <input class="i-ltol-m numxs" value="${v(ltol?.m)}" />'
            <input class="i-ltol-s numxs" value="${v(ltol?.s)}" />"
          </span></td>`;
      } else {
        specCells = `
          <td><input class="i-nominal num" value="${fmt(it.nominal ?? '')}" /></td>
          <td><input class="i-upperTol num" value="${fmt(upperTol)}" placeholder="+0.05" /></td>
          <td><input class="i-lowerTol num" value="${fmt(lowerTol)}" placeholder="-0.05" /></td>`;
      }

      const unitCell = isAngle
        ? `<td><input class="i-unit unit" value="°" readonly /></td>`
        : `<td><input class="i-unit unit" value="${esc(it.unit ?? '')}" /></td>`;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="i-drag" title="ドラッグで並べ替え">⠿</td>
        <td><input class="i-label" value="${esc(it.label)}" /></td>
        ${typeCell}
        ${specCells}
        ${unitCell}
        <td><button type="button" class="i-del">×</button></td>`;
      // 行 tr を閉じ込めて直接削除（並べ替えで行番号がズレても正しい行を消す）
      tr.querySelector<HTMLButtonElement>('.i-del')!.addEventListener('click', () => {
        tr.remove();
      });
      // 種別/形式を変えたら、現在値を保持したまま欄構成を再描画
      tr.querySelector<HTMLSelectElement>('.i-type')!.addEventListener('change', () =>
        renderItems(collectItems())
      );
      tr.querySelector<HTMLSelectElement>('.i-aformat')?.addEventListener('change', () =>
        renderItems(collectItems())
      );
      itemsTable.appendChild(tr);
    });
    enableRowDrag(itemsTable);
  };

  const collectItems = (): MeasureItem[] => {
    const rows = Array.from(itemsTable.querySelectorAll('tr')).slice(1);
    return rows.map((tr) => {
      const g = (s: string) => (tr.querySelector(s) as HTMLInputElement)?.value ?? '';
      const type = (tr.querySelector('.i-type') as HTMLSelectElement).value as ItemType;
      const numOrU = (v: string) => (v.trim() === '' ? undefined : Number(v));

      let nominal: number | undefined;
      let upperTol: number | undefined;
      let lowerTol: number | undefined;
      let decimals: number | undefined;
      // 現在DOMにある欄で判定（種別切替の途中でも値を失わない）
      if (tr.querySelector('.i-nom-d')) {
        const n = (s: string) => Number(g(s) || 0);
        const hasNom = ['.i-nom-d', '.i-nom-m', '.i-nom-s'].some((s) => g(s).trim() !== '');
        nominal = hasNom ? dmsToDeg(n('.i-nom-d'), n('.i-nom-m'), n('.i-nom-s')) : undefined;
        // 上公差は＋側、下公差は−側の大きさ（度分秒）。空欄側は未設定。
        const hasU = ['.i-utol-d', '.i-utol-m', '.i-utol-s'].some((s) => g(s).trim() !== '');
        const hasL = ['.i-ltol-d', '.i-ltol-m', '.i-ltol-s'].some((s) => g(s).trim() !== '');
        upperTol = hasU ? dmsToDeg(n('.i-utol-d'), n('.i-utol-m'), n('.i-utol-s')) : undefined;
        lowerTol = hasL ? -dmsToDeg(n('.i-ltol-d'), n('.i-ltol-m'), n('.i-ltol-s')) : undefined;
      } else {
        const nominalStr = g('.i-nominal');
        const upperStr = g('.i-upperTol');
        const lowerStr = g('.i-lowerTol');
        nominal = numOrU(nominalStr);
        upperTol = numOrU(upperStr);
        lowerTol = numOrU(lowerStr);
        // 入力文字列の小数桁を桁数として保持（"0.100"→3）
        decimals = Math.max(
          decimalsOf(nominalStr),
          decimalsOf(upperStr),
          decimalsOf(lowerStr)
        );
      }
      const angleFormat =
        type === 'angle'
          ? (((tr.querySelector('.i-aformat') as HTMLSelectElement)?.value ?? 'decimal') as AngleFormat)
          : undefined;
      // 基準値＋上下公差から上限/下限を自動計算
      return applyTolerance({
        id: crypto.randomUUID(),
        label: g('.i-label').trim(),
        type,
        nominal,
        upperTol,
        lowerTol,
        unit: type === 'angle' ? '°' : g('.i-unit').trim() || undefined,
        decimals,
        angleFormat,
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
        process: ($('#tplProcess') as HTMLInputElement).value.trim() || undefined,
        items: collectItems().filter((i) => i.label !== ''),
      };
      // 品番/品名/工程を編集してキーが変わった場合は旧エントリを削除
      if (originalKey && originalKey !== templateKey(newTpl)) {
        deleteTemplate(originalKey);
      }
      saveTemplate(newTpl);
      refreshPartSelect();
      // 編集中の品番が現在のセッションなら反映を促す（新規測定で適用）
    } else if (action === 'delete') {
      const partNoVal = ($('#tplPartNo') as HTMLInputElement).value.trim();
      const processVal = ($('#tplProcess') as HTMLInputElement).value.trim();
      const delKey =
        originalKey ??
        templateKey({
          partNo: partNoVal,
          name: ($('#tplName') as HTMLInputElement).value.trim() || undefined,
          process: processVal || undefined,
        });
      const disp = processVal ? `${partNoVal} / ${processVal}` : partNoVal;
      if (partNoVal && confirm(`テンプレ「${disp}」を削除しますか？`)) {
        deleteTemplate(delKey);
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

/** 数値文字列の小数桁数を数える（"0.100"→3, "10"→0, 空/非数→0）。 */
function decimalsOf(s: string): number {
  const t = s.trim();
  if (t === '' || Number.isNaN(Number(t))) return 0;
  const dot = t.indexOf('.');
  return dot === -1 ? 0 : t.length - dot - 1;
}

/**
 * テンプレ項目テーブルの行を、ハンドル(.i-drag)ドラッグで並べ替え可能にする。
 * マウス/タッチ両対応のため Pointer Events を使用。DOM ノードごと移動するので
 * 入力値は保持され、保存時に collectItems() が新しい順で読み取る。
 */
function enableRowDrag(table: HTMLTableElement): void {
  table.querySelectorAll<HTMLTableCellElement>('.i-drag').forEach((handle) => {
    handle.addEventListener('pointerdown', (e) => {
      const row = handle.closest('tr');
      if (!row) return;
      e.preventDefault();
      row.classList.add('dragging');

      // move/up は window で受ける。掴んだ行を insertBefore で動かすとポインタ
      // キャプチャが外れて pointermove が途切れるため、ハンドルには紐付けない。
      const onMove = (ev: PointerEvent) => {
        // ハンドルを持つデータ行のうち、掴んだ行以外を対象に挿入位置を決める
        const rows = Array.from(
          table.querySelectorAll<HTMLTableRowElement>('tr')
        ).filter((r) => r !== row && r.querySelector('.i-drag'));
        let inserted = false;
        for (const r of rows) {
          const rect = r.getBoundingClientRect();
          if (ev.clientY < rect.top + rect.height / 2) {
            table.insertBefore(row, r);
            inserted = true;
            break;
          }
        }
        if (!inserted) table.appendChild(row); // 末尾より下なら最後尾へ
      };

      const onUp = () => {
        row.classList.remove('dragging');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  });
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
          '［OK］追記（品番・品名・工程が同じものは上書き） ／ ［キャンセル］全置換'
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
  // サーバー(共有)から全テンプレートを取得して端末キャッシュへ反映（失敗時はキャッシュのまま）
  await initTemplates();

  state = {
    templates: loadTemplates(),
    session: null as unknown as Session,
    active: { row: 0, col: 0 },
  };

  // テンプレが無ければサンプルを投入（サーバーにも反映される）
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
  syncFileNameField();
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
  // 名前を編集したら現在セッションへ反映し自動保存に載せる
  els.fileName.addEventListener('input', () => {
    state.session.label = els.fileName.value.trim() || undefined;
    autosave();
  });
  els.loadBtn.addEventListener('click', () => void openLoadDialog());
  els.loadClose.addEventListener('click', () => els.loadDialog.close());
  els.partSelect.addEventListener('change', () => {
    // 選択しただけでは切替えない（新規測定ボタンで適用）。プレビュー用に通知。
    const label =
      els.partSelect.selectedOptions[0]?.textContent ?? '';
    els.voiceStatus.textContent = `「新規測定」で ${label} を適用`;
  });
  els.tplNewBtn.addEventListener('click', () => openTemplateEditor());
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
  els.slowInputChk.checked = getSlowInput();
  els.slowInputChk.addEventListener('change', () => {
    setSlowInput(els.slowInputChk.checked);
    resetPending(); // モード切替時に未確定バッファをクリア
  });
  els.histChk.checked = getShowHistogram();
  els.histChk.addEventListener('change', () => {
    setShowHistogram(els.histChk.checked);
    render(); // グラフの表示/非表示を即反映
  });
  els.exportBtn.addEventListener('click', () => exportSession(state.session));

  if (!isVoiceSupported()) {
    els.voiceBtn.disabled = true;
    els.voiceBtn.textContent = '🎤 音声非対応';
    els.voiceStatus.textContent = 'このブラウザは音声非対応(Edge/Chrome推奨)。手入力で利用可。';
  }
}

void init();
