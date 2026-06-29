// 日本語音声認識結果のゆらぎを吸収して数値へ正規化する。
// 例: "12点34" -> 12.34 / "マイナス0点5" -> -0.5 / "十二点三四" -> 12.34

const ZEN_TO_HAN: Record<string, string> = {
  '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
  '．': '.', '－': '-', 'ー': '-', '−': '-',
};

const KANJI_DIGIT: Record<string, number> = {
  '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
  '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
};

const KANJI_UNIT: Record<string, number> = {
  '十': 10, '百': 100, '千': 1000,
};

/** 除去する単位・ノイズ語 */
const NOISE = /(ミリメートル|ミリメーター|ミリ|センチメートル|センチ|マイクロ|度|ミリ?メートル|mm|cm|μm)/gi;

/** "十二" のような漢数字（整数部）を数値へ。千まで対応。 */
function kanjiIntToNumber(s: string): number | null {
  if (s === '') return null;
  // 既に算用数字ならそのまま
  if (/^\d+$/.test(s)) return parseInt(s, 10);

  let total = 0;
  let current = 0;
  let matchedAny = false;
  for (const ch of s) {
    if (ch in KANJI_DIGIT) {
      current = KANJI_DIGIT[ch];
      matchedAny = true;
    } else if (ch in KANJI_UNIT) {
      const unit = KANJI_UNIT[ch];
      total += (current === 0 ? 1 : current) * unit;
      current = 0;
      matchedAny = true;
    } else {
      return null; // 想定外文字
    }
  }
  total += current;
  return matchedAny ? total : null;
}

/** 漢数字を一桁ずつ算用数字へ（小数部用）。"三四" -> "34" */
function kanjiDigitsToString(s: string): string | null {
  let out = '';
  for (const ch of s) {
    if (ch in KANJI_DIGIT) out += String(KANJI_DIGIT[ch]);
    else if (/\d/.test(ch)) out += ch;
    else return null;
  }
  return out;
}

/**
 * 音声テキストを数値へ正規化する。解釈できなければ null。
 */
export function parseNumber(raw: string): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (s === '') return null;

  // 全角→半角
  s = s.replace(/[０-９．－ー−]/g, (c) => ZEN_TO_HAN[c] ?? c);
  // 単位・ノイズ語・空白を除去
  s = s.replace(NOISE, '').replace(/\s+/g, '');

  // 符号
  let sign = 1;
  s = s.replace(/^(マイナス|ﾏｲﾅｽ|negative|minus)/i, () => {
    sign = -1;
    return '';
  });
  if (s.startsWith('-')) {
    sign = -1;
    s = s.slice(1);
  }
  if (s.startsWith('プラス') || s.startsWith('+')) {
    s = s.replace(/^(プラス|\+)/, '');
  }

  // 小数点語を "." に統一
  s = s.replace(/(点|コンマ|カンマ|、|，|,|ドット|dot|point|てん)/gi, '.');

  if (s === '' || s === '.') return null;

  const parts = s.split('.');
  if (parts.length > 2) return null; // 小数点が複数

  const intRaw = parts[0];
  const fracRaw = parts.length === 2 ? parts[1] : '';

  // 整数部
  let intVal = 0;
  if (intRaw !== '') {
    const v = kanjiIntToNumber(intRaw);
    if (v === null) return null;
    intVal = v;
  }

  // 小数部（一桁ずつ）
  let fracStr = '';
  if (fracRaw !== '') {
    const v = kanjiDigitsToString(fracRaw);
    if (v === null) return null;
    fracStr = v;
  }

  const numStr = fracStr === '' ? String(intVal) : `${intVal}.${fracStr}`;
  const result = Number(numStr);
  if (Number.isNaN(result)) return null;
  return sign * result;
}

export type VoiceCommand = 'next' | 'prev' | 'undo' | 'confirm' | 'ok' | 'ng';

/** 音声コマンド語を判定（数値でない発話用） */
export function parseCommand(raw: string): VoiceCommand | null {
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, '');
  if (/(次|つぎ|next)/.test(s)) return 'next';
  if (/(戻る|もどる|前|back|prev)/.test(s)) return 'prev';
  if (/(やり直し|やりなおし|取り消し|消去|クリア|undo|clear)/.test(s)) return 'undo';
  if (/(確定|決定|enter|ok確定)/.test(s)) return 'confirm';
  if (/^(オーケー|おっけー|おっけ|良|合格|ok)$/.test(s)) return 'ok';
  if (/^(エヌジー|だめ|不良|不合格|ng)$/.test(s)) return 'ng';
  return null;
}
