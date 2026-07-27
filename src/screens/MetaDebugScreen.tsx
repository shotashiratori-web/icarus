import { useCallback, useRef, useState } from 'react';
import { parse as parseExif, orientation as parseOrientation, gps as parseGps } from 'exifr';
import type { Screen } from '../App';
import styles from './MetaDebugScreen.module.css';

type Props = { go: (s: Screen) => void };
type InputMethod = 'picker' | 'drop' | null;

// 画像から取得できる全メタデータを可視化するための調査ツール（Phase: メタデータ抽出調査）。
// GPS修正は行わず、EXIF・画像自体から拾えるものを丸ごとJSONで出す。
const FULL_EXIF_OPTIONS = {
  tiff: true,
  // ifd0はexifrの型上つねに有効（無効化不可）のため指定不要
  ifd1: true,
  exif: true,
  gps: true,
  interop: true,
  xmp: true,
  icc: true,
  iptc: true,
  jfif: true,
  ihdr: true,
  mergeOutput: true,
} as const;

function readImagePixelSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function serializeExifValue(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Uint8Array || v instanceof ArrayBuffer) return `<binary ${(v as Uint8Array).byteLength ?? 0} bytes>`;
  if (Array.isArray(v)) return v.map(serializeExifValue);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = serializeExifValue(val);
    return out;
  }
  return v;
}

export default function MetaDebugScreen({ go }: Props) {
  const [result, setResult] = useState<string>('');
  const [processing, setProcessing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File, method: InputMethod) => {
    setProcessing(true);
    setCopyState('idle');
    try {
      const [fullExif, orientationTag, gps, pixelSize] = await Promise.all([
        parseExif(file, FULL_EXIF_OPTIONS).catch(() => null),
        parseOrientation(file).catch(() => undefined),
        parseGps(file).catch(() => undefined),
        readImagePixelSize(file),
      ]);

      const output = {
        capturedBy: {
          inputMethod: method,
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          extractedAt: new Date().toISOString(),
        },
        file: {
          name: file.name,
          type: file.type,
          sizeBytes: file.size,
          lastModified: file.lastModified ? new Date(file.lastModified).toISOString() : null,
        },
        renderedImage: pixelSize,
        orientationTag: orientationTag ?? null,
        gpsConvenience: gps ? { lat: gps.latitude, lng: gps.longitude } : null,
        exifAvailable: !!fullExif,
        exifRaw: fullExif ? serializeExifValue(fullExif) : null,
      };

      setResult(JSON.stringify(output, null, 2));
    } catch (e) {
      setResult(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }, null, 2));
    } finally {
      setProcessing(false);
    }
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void processFile(file, 'picker');
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void processFile(file, 'drop');
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      // クリップボードAPIが使えない環境（一部モバイルブラウザ）向けのフォールバックは不要。手動選択でコピー可能
    }
  };

  const handleDownload = () => {
    const blob = new Blob([result], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `exif-debug-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'home' })}>← ホーム</button>
        <span className={styles.title}>🔬 画像メタデータ調査</span>
      </header>

      <main className={styles.main}>
        <p className={styles.description}>
          写真を1枚選ぶ（またはドラッグ&ドロップ）と、その写真から取得できる全てのメタデータをJSONで表示します。
          GPSの修正は行いません。取得できるもの・できないものを確認するためのデバッグ専用画面です。
        </p>

        <div
          className={`${styles.dropZone} ${dragActive ? styles.dropZoneActive : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <span className={styles.dropZoneText}>
            {processing ? '解析中…' : 'クリックして写真を選択、またはここにドラッグ&ドロップ'}
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className={styles.hiddenInput}
            onChange={handleFileInput}
          />
        </div>

        {result && (
          <div className={styles.resultBox}>
            <div className={styles.resultActions}>
              <button className={styles.actionBtn} onClick={() => void handleCopy()}>
                {copyState === 'copied' ? '✓ コピーしました' : 'コピー'}
              </button>
              <button className={styles.actionBtn} onClick={handleDownload}>ダウンロード(.json)</button>
            </div>
            <pre className={styles.jsonOutput}>{result}</pre>
          </div>
        )}
      </main>
    </div>
  );
}
