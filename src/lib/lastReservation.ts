// 予約結果（受取番号）の再表示用ストレージ（Rev12・提案1）。
//   予約成功時に slug 単位で localStorage へ保存し、同じ端末・ブラウザで再訪したときに
//   完了画面（受取番号＋内訳）を復元する。キャンセル成功時に削除する。
//   installId.ts と同じく localStorage 不可（プライベートブラウズ等）でも例外を握らず動作継続。
import type { CreateReservationResult, ReservedItem } from './types';

const PREFIX = 'urehan_reserve_last_v1:';
// イベントはせいぜい数週間先まで＝30日を過ぎたら「古い可能性がある」と**注記を添えて表示**する
// （同じ slug が別イベントへ再利用された場合の混同防止）。Rev84 まではここで削除していた＝下の loadLastReservation 参照。
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SavedReservation {
  reservation_id: string;
  pickup_no: number;
  items: ReservedItem[]; // 確定した予約内訳（完了画面の再表示用スナップショット）
  /** 0113: 送信した備考。**画面へ復元して見せるためだけ**に持つ（サーバーの値を取り直す口は無い）。
   *  無い版で保存された古い値もそのまま読めるように任意にする。 */
  buyer_note?: string;
  savedAt: number; // epoch ms
  /** 保存から TTL を超えている（＝別イベントの使い回しかもしれない）。表示はするが注記を添える。 */
  stale?: boolean;
}

export function saveLastReservation(
  slug: string,
  result: CreateReservationResult,
  items: ReservedItem[],
  buyerNote?: string,
): void {
  try {
    const data: SavedReservation = {
      reservation_id: result.reservation_id,
      pickup_no: result.pickup_no,
      items,
      // 空文字は入れない（`buyer_note` が無い＝備考なし、で表現を1つに保つ＝api.ts と同じ扱い）。
      ...(buyerNote && buyerNote.trim() ? { buyer_note: buyerNote } : {}),
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
    // 0113: 備考は任意。**型が違えば黙って捨てる**（復元の失敗で受取番号ごと消さない）。
    if (typeof v.buyer_note !== 'string') delete v.buyer_note;
    // 🔴 Rev84（ラウンド16・班E 注意6／CLOCK-TRUST）: 旧実装は TTL 超過で**消していた**。
    //   savedAt は買い手端末の時計で打っており、時計が狂っている（あるいは手動で進めた）だけで
    //   当日ブースの前で受取番号が消える。買い手は番号を提示できず、取り消しボタンも
    //   出ないので自分では取り消せない＝復旧不能。
    //   本体アプリの会計下書き（RegisterScreen「一定時間を過ぎた下書きは捨てる方式は採らない」）と
    //   同じ判断に揃える＝**消すのは復旧不能・気づかせるのは可逆**なので可逆な側に倒す。
    //   実際に消えるのはキャンセル成功時だけ。
    const savedAt = typeof v.savedAt === 'number' ? v.savedAt : 0;
    const stale = savedAt <= 0 || Date.now() - savedAt > TTL_MS;
    return { ...(v as SavedReservation), savedAt, stale };
  } catch {
    return null;
  }
}

export function clearLastReservation(slug: string): void {
  try {
    localStorage.removeItem(PREFIX + slug);
  } catch {
    // 消せなくても実害は小さい（取り消し済みの番号が再表示されるだけで、当日その番号は無効）。
  }
}
