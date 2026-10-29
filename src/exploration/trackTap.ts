// 探索履歴（GPX）の線を押した時（2D・3D）: 押した所から指 1 本分以内の線を、近い順に最大 3 本、地点情報の一番上に出す。
// 白縁の線だけで押させると細くて当たらないので、道（roads.ts の roadAtTap）と同じ出し方にする
import { distanceToTrackM } from '../terrain/coverage';
import { PURPOSE_LABEL, RESULT_LABEL, type Purpose, type TargetResult, type TrackSegments } from './types';

export interface TrackTapEntry {
  exploredOn: string | null;
  purpose: Purpose;
  explorerNames: string[];
  distanceM: number;
  rawDistanceM: number;
  useRange: unknown;
  targets: { target: string; result: TargetResult }[];
  hypothesis: { name: string; conditionText: string[] } | null;
  origin: 'server' | 'device';
  status: string;
  track: TrackSegments | null;
}

export const TRACK_TAP_MAX = 3;

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`);

export function trackLine(e: TrackTapEntry): string {
  const parts = [
    e.exploredOn ?? '日付なし',
    PURPOSE_LABEL[e.purpose],
    e.explorerNames.join('、') || '歩いた人未記入',
    `${km(e.distanceM)}${e.useRange ? `（記録全体 ${km(e.rawDistanceM)}）` : ''}`,
  ];
  const targets = e.targets.map((t) => `${t.target}: ${RESULT_LABEL[t.result]}`).join('、');
  let s = `この線：${parts.join('・')}${targets ? `（${targets}）` : ''}`;
  if (e.hypothesis) s += `・仮説「${e.hypothesis.name}」（${e.hypothesis.conditionText.join(' かつ ')}）`;
  if (e.origin === 'device') s += `・この端末のみ（${e.status === 'registered' ? '登録済み' : '未登録'}）`;
  return s;
}

export function tracksAtTap(entries: TrackTapEntry[], lat: number, lng: number, toleranceM: number, max = TRACK_TAP_MAX): string[] {
  return entries
    .filter((e) => e.track && e.track.length)
    .map((e) => ({ e, d: distanceToTrackM(lat, lng, e.track!) }))
    .filter((x) => x.d <= toleranceM)
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((x) => trackLine(x.e));
}
