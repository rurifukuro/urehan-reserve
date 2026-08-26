import { supabase, isTrustedStorageUrl } from './supabase';
import type { ReservationPage, ReservedItem, CreateReservationResult } from './types';

// slug からお品書きページを取得（security definer RPC・owner_token_hash は返らない）。
// 集合返し関数なので戻りは配列。先頭行を返す（無ければ null）。
export async function getReservationPage(slug: string): Promise<ReservationPage | null> {
  const { data, error } = await supabase.rpc('get_reservation_page', { p_slug: slug });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ReservationPage[];
  const row = rows[0];
  if (!row) return null;
  // close_at は bigint（migration 0020）。PostgREST が文字列で返す場合に備えて数値へ正規化（不正値は null）。
  const closeAt = row.close_at == null ? null : Number(row.close_at);
  return {
    ...row,
    items: Array.isArray(row.items) ? row.items : [],
    // 🔴 Rev87（ラウンド18・班J 重要 J-1）: **オリジンを検証してから取り込む**。
    //   この配列は anon が書ける列から来る＝任意ドメインを入れられる。`<img src>`（ReservePage.tsx:464,482）
    //   に流れる前の唯一の境界がここ。通す判定はこの 1 箇所に置く（表示側で弾く形にすると、
    //   別の表示経路が増えたときに素通りする）。詳細は `isTrustedStorageUrl` のコメント。
    oshinagaki_urls: Array.isArray(row.oshinagaki_urls)
      ? row.oshinagaki_urls.filter(
          (u): u is string => typeof u === 'string' && u.length > 0 && isTrustedStorageUrl(u),
        )
      : [],
    close_at: closeAt != null && Number.isFinite(closeAt) ? closeAt : null,
  };
}

// 予約を作成して受取番号を採番。合計はサーバー側で再計算される（クライアント値は信用されない）。
//
// 🔴 Rev84（ラウンド16・班E 重要3／冪等）: `requestId` は**送信ごとに1個**で、
//   通信失敗による再送では**同じ値**を送る。サーバー（migration 0062）は同じ
//   (page_id, request_id) の予約があれば新規作成せず既存行の受取番号を返す。
//   これが無いと「サーバーは INSERT を commit したが応答が電波で落ちた」ときの再送で
//   二重予約になり、在庫が二重に押さえられる（当日渡せない取り置きが生まれる）。
//
// 🔴 Rev84（重要1／CLOCK-TRUST）: `p_now` は互換のため送るが**サーバーは使わない**（0062）。
//   締切判定と保存時刻はサーバー時計に統一した。ここを消すと旧サーバーで動かなくなるので残す。
export async function createReservation(
  slug: string,
  nickname: string,
  installId: string,
  items: ReservedItem[],
  requestId: string,
  password?: string,
  // 0113: 買い手からの備考（任意）。**送らなくても通る**＝DEFAULT NULL の引数なので、
  //   この Web を出す前の版（7引数）も同じ関数で解決される。
  buyerNote?: string,
): Promise<CreateReservationResult> {
  const { data, error } = await supabase.rpc('create_reservation', {
    p_slug: slug,
    p_nickname: nickname,
    p_installation_id: installId,
    p_items: items,
    p_now: Date.now(),
    p_password: password || null,
    p_request_id: requestId,
    // 🔴 空文字は送らず null にする。サーバー側も `nullif(btrim(...),'')` で null へ寄せているが、
    //   ここで '' を送ると「備考あり（中身は空）」に見える経路が1つ増える＝表現を1つに保つ。
    p_buyer_note: buyerNote && buyerNote.trim() ? buyerNote : null,
  });
  // ⚠ デプロイ順序: migration 0062（`p_request_id` 付き）／0113（`p_buyer_note` 付き）を
  //   **先に**本番へ適用してからこの Web をデプロイすること。
  //   逆順にすると旧サーバーが引数を知らず PGRST202 で全滅する。
  //   （0113 は 2026-08-26 に本番適用済み＝旧7引数・新8引数の両方で解決されることを実測している）
  //   ここで PGRST202 を握って旧シグネチャへ落とすことは**しない**——落とせば冪等性が失われ、
  //   再送で二重予約に戻る（塞いだ穴が黙って開くより、送信できない方が被害が小さい）。
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as CreateReservationResult[];
  const row = rows[0];
  if (!row) throw new Error('no result');
  return row;
}

// 自分の予約を取り消す（installation_id 照合・受取済みは不可）。
export async function cancelReservation(reservationId: string, installId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('cancel_reservation', {
    p_reservation_id: reservationId,
    p_installation_id: installId,
    p_now: Date.now(),
  });
  if (error) throw new Error(error.message);
  return data === true;
}
