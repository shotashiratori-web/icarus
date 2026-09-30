// アプリの版（vite の define で GitHub Actions のコミットの先頭 7 文字が入る。手元・テストは dev）
declare const __APP_BUILD__: string | undefined;
export const APP_BUILD: string = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : 'dev';
