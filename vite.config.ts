import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cloudflare()],
  base: './',
  // 2026-09-15: 白画面インシデント対応。build.target未指定だとデフォルトのモダンな出力になり、
  // ?.（optional chaining）・??（nullish coalescing）等のES2020構文がそのまま出力される。
  // これはES2020未満のエンジン（iOS 12以下のSafari等、古い端末）では構文解析自体に失敗し、
  // JSが1行も実行されない＝React起動前のため既存のErrorBoundaryでも救えない「本物の白紙」になる。
  // target を広げ、対応構文へ変換させることで古い端末でも最低限起動できるようにする
  build: {
    target: ['es2017', 'safari12', 'ios12'],
  },
  server: {
    host: true,
    port: 5173,
  },
})