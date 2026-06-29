// 音声認識アダプタ。Web Speech API 実装。
// 将来オフライン(Vosk)へ差し替えられるよう、この層だけ置き換えれば済む構造にする。

export interface RecognizerHandlers {
  onResult: (transcript: string, isFinal: boolean) => void;
  onError?: (message: string) => void;
  onStateChange?: (listening: boolean) => void;
}

type SpeechRecognitionCtor = new () => any;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function isVoiceSupported(): boolean {
  return getCtor() !== null;
}

export class Recognizer {
  private rec: any = null;
  private handlers: RecognizerHandlers;
  private wantListening = false;

  constructor(handlers: RecognizerHandlers) {
    this.handlers = handlers;
  }

  private build(): boolean {
    const Ctor = getCtor();
    if (!Ctor) {
      this.handlers.onError?.('このブラウザは音声認識に未対応です（Edge/Chrome推奨）');
      return false;
    }
    const rec = new Ctor();
    rec.lang = 'ja-JP';
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const transcript = res[0]?.transcript ?? '';
        this.handlers.onResult(transcript, res.isFinal);
      }
    };
    rec.onerror = (e: any) => {
      this.handlers.onError?.(`音声認識エラー: ${e.error ?? 'unknown'}`);
    };
    rec.onend = () => {
      // continuous でも自動停止することがあるため、希望時は再開
      if (this.wantListening) {
        try {
          rec.start();
        } catch {
          /* 連続start例外は無視 */
        }
      } else {
        this.handlers.onStateChange?.(false);
      }
    };
    this.rec = rec;
    return true;
  }

  start(): void {
    if (!this.rec && !this.build()) return;
    this.wantListening = true;
    try {
      this.rec.start();
      this.handlers.onStateChange?.(true);
    } catch {
      /* 既に開始済みなら無視 */
    }
  }

  stop(): void {
    this.wantListening = false;
    try {
      this.rec?.stop();
    } catch {
      /* 無視 */
    }
    this.handlers.onStateChange?.(false);
  }

  get listening(): boolean {
    return this.wantListening;
  }
}

/** TTSで読み返す（誤認識検知用）。空文字や未対応時は何もしない。 */
export function speak(text: string): void {
  if (!text || !('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.rate = 1.1;
    window.speechSynthesis.cancel(); // 直前の読み上げを止めて被りを防ぐ
    window.speechSynthesis.speak(u);
  } catch {
    /* 無視 */
  }
}

/** 警告音（NG時）。WebAudioで短いビープ。 */
let audioCtx: AudioContext | null = null;
export function beep(freq = 880, durationMs = 220): void {
  try {
    audioCtx =
      audioCtx ?? new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + durationMs / 1000);
  } catch {
    /* 無視 */
  }
}
