// 予約結果（受取番号）の再表示用ストレージ（Rev12・提案1）。
//   予約成功時に slug 単位で localStorage へ保存し、同じ端末・ブラウザで再訪したときに
//   完了画面（受取番号＋内訳）を復元する。キャンセル成功時に削除する。
//   installId.ts と同じく localStorage 不可（プライベートブラウズ等）でも例外を握らず動作継続。
import type { CreateReservationResult, ReservedItem } from './types';

const PREFIX = 'urehan_reserve_last_v1:';
// イベントはせいぜい数週間先まで＝30日で自然失効（同じ slug が別イベントへ再利用された場合の混同防止）。
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SavedReservation {
  reservation_id: string;
  pickup_no: number;
  items: ReservedItem[]; // 確定した予約内訳（完了画面の再表示用スナップショット）
  savedAt: number; // epoch ms
}

export function saveLastReservation(
  slug: string,
  result: CreateReservationResult,
  items: ReservedItem[],
): void {
  try {
    const data: SavedReservation = {
      reservation_id: result.reservation_id,
      pickup_no: result.pickup_no,
      items,
      savedAt: Date.now(),
    };
    localStorage.setItem(PREFIX + slug, JSON.stringify(data));
  } catch {
    // 保存できない環境では従来どおり「その場限りの表示」になるだけ（実害なし）
  }
}

export function loadLastReservation(slug: string): SavedReservation | null {
  try {
    const raw = localStorage.getItem(PREFIX + slug);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedReservation> | null;
    if (!v || typeof v !== 'object') return null;
    if (typeof v.reservation_id !== 'string' || typeof v.pickup_no !== 'number' || !Array.isArray(v.items)) {
      return null;
    }
    if (typeof v.savedAt !== 'number' || Date.now() - v.savedAt > TTL_MS) {
      clearLastReservation(slug);
      return null;
    }
    return v as SavedReservation;
  } catch {
    return null;
  }
}

export function clearLastReservation(slug: string): void {
  try {
    localStorage.removeItem(PREFIX + slug);
  } catch {
    // 消せなくても TTL で自然失効する
  }
}
