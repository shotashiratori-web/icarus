import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { cloudflare } from "@cloudflare/vite-plugin";
import type { Plugin } from 'vite'

// 2026-09-28 Exploration Mode Stage 1: その版のファイル一覧を出す。Service Worker（public/sw.js）が
// これを見て、遅延読み込みの分も含めて全部を端末に保存し、前の版のファイルを消す（圏外でもどの画面も開ける）
function assetManifest(): Plugin {
  return {
    name: 'icarus-asset-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => f.startsWith('assets/')).sort()
      this.emitFile({ type: 'asset', fileName: 'asset-manifest.json', source: JSON.stringify({ files }) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cloudflare(), assetManifest()],
  base: './',
  // 2026-09-30: 画面に出す版（GitHub Actions のコミット）。iPhone のホーム画面版が新しい版になったかを確かめるため
  define: { __APP_BUILD__: JSON.stringify((process.env.GITHUB_SHA ?? 'dev').slice(0, 7)) },
  // 2026-09-16: 2026-09-15に追加したbuild.target（es2017/safari12/ios12への拡張）をrevert。
  // 当時は「新規スタッフの白紙は古いSafariの構文非対応が原因」という仮説だったが、実機がiPhone 16
  // （最新機種）と判明し前提が崩れた。加えて、構文変換だけでは互換性の裏付けとして不十分
  // （アプリが使うWeb APIがSafari 12で動く保証はしていない）。確証のない古ブラウザ対応を
  // 中途半端に残すより、デフォルトのtargetへ戻す。古いSafari対応が必要になったら、実機情報
  // またはPR #36系の起動時エラー表示で実際のエラーを見てから改めて判断する
  server: {
    host: true,
    port: 5173,
  },
})