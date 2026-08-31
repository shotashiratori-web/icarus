// 各entity adapterのregisterAdapter()呼び出しをモジュール読み込み時の副作用として実行するための集約ファイル。
// App.tsx冒頭で一度importすることで、どの画面が最初にsubmitWithFallbackを呼んでもレジストリが埋まっている状態を保証する。
import './foodLogAdapter';
import './fieldLogD1Adapter';
import './wineTastingNoteAdapter';
import './wineTastingNotePhotoAdapter';
