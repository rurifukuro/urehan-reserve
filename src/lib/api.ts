import { supabase, isTrustedStorageUrl } from './supabase';
import type {
  ReservationPage, ReservedItem, CreateReservationResult,
  LotteryPublicItem, MyReservation, MyReservationItem, UpdateReservationQtyResult,
} from './types';

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
  // 0158: 応募する抽選商品の key。空なら null を送る（＝抽選に応募しない回は v8 と同じ挙動）。
  //   🔴 抽選の商品は `items` に入れない（サーバーが lottery_item_in_items で弾く）。
  lotteryKeys: string[] = [],
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
    // ⚠ 0158（create_reservation v9・9引数）は本番適用済み（とれはんっ！ Rev835）。
    p_lottery_keys: lotteryKeys.length > 0 ? lotteryKeys : null,
  });
  // ⚠ デプロイ順序: migration 0062（`p_request_id` 付き）／0113（`p_buyer_note` 付き）を
  //   **先に**本番へ適用してからこの Web をデプロイすること。
  //   逆順にすると旧サーバーが引数を知らず PGRST202 で全滅する。
  //   （0113 は 2026-08-26 に本番適用済み＝旧7引数・新8引数の両方で解決されることを実測している）
  //   ここで PGRST202 を握って旧シグネチャへ落とすことは**しない**——落とせば冪等性が失われ、
  //   再送で二重予約に戻る（塞いだ穴が黙って開くより、送信できない方が被害が小さい）。
  //
  // 🔴 順序はもう一段ある: **アプリ側（レジさぽっ！ 1.0.7 以降）の配信が行き渡ってから**この Web を出す。
  //   備考を表示するのはアプリの予約管理画面（`src/components/ReservationManagerModal.tsx`・Rev151）で、
  //   それ以前の版は `buyer_note` を読まない＝**買い手が書いた備考が売り手に一切届かない**。
  //   サーバーは受け取って保存するのでエラーは出ず、画面にも何も出ない（気づく手掛かりが無い）。
  //   買い手からは「備考に書いたのに対応されなかった」に見える＝取り置きの信用を直接削る。
  //   ストア更新は強制ではないので「配信済み＝全員が新版」ではない。それでも
  //   **旧版が残っている状態で欄を先に開ける**のは、届かないと分かっている入力欄を出すことなので採らない。
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

// ── 0158: 取り置き限定の抽選 ─────────────────────────────────────────

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 予約ページに出す抽選の設定（公開・slug だけ）。🔴 応募数はサーバーが返さない（決定19）。
 *  ページが無いときサーバーは null を返す＝空配列として扱う（ページ自体の有無は get_reservation_page が決める）。 */
export async function getReservationLotteryPublic(slug: string): Promise<LotteryPublicItem[]> {
  const { data, error } = await supabase.rpc('get_reservation_lottery_public', { p_slug: slug });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  const out: LotteryPublicItem[] = [];
  for (const raw of data as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object' || typeof raw.key !== 'string') continue;
    const kind = raw.kind === 'bonus' ? 'bonus' : raw.kind === 'purchase' ? 'purchase' : null;
    if (!kind) continue;
    const bt = raw.bonusTarget === 'optin' || raw.bonusTarget === 'holders' ? raw.bonusTarget : null;
    out.push({
      key: raw.key,
      kind,
      bonusTarget: kind === 'bonus' ? bt : null,
      bonusSourceKeys: Array.isArray(raw.bonusSourceKeys)
        ? raw.bonusSourceKeys.filter((k): k is string => typeof k === 'string')
        : [],
      winners: num(raw.winners) ?? 0,
      qtyPerWinner: num(raw.qtyPerWinner) ?? 0,
      deadlineMode: raw.deadlineMode === 'at' ? 'at' : 'page',
      deadlineAt: num(raw.deadlineAt),
      drawn: raw.drawn === true,
      drawnAt: num(raw.drawnAt),
    });
  }
  return out;
}

/** 自分の取り置き＋抽選の結果（rid＋端末ID＋slug の3点一致）。一致しなければ null。 */
export async function getMyReservation(
  slug: string,
  reservationId: string,
  installId: string,
): Promise<MyReservation | null> {
  const { data, error } = await supabase.rpc('get_my_reservation', {
    p_slug: slug,
    p_reservation_id: reservationId,
    p_installation_id: installId,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object') return null;
  const r = data as Record<string, unknown>;
  const status = r.status === 'collected' || r.status === 'cancelled' ? r.status : 'pending';
  return {
    reservation_id: String(r.reservation_id ?? reservationId),
    pickup_no: num(r.pickup_no) ?? 0,
    nickname: typeof r.nickname === 'string' ? r.nickname : '',
    items: normalizeItems(r.items),
    total_price: num(r.total_price) ?? 0,
    status,
    buyer_note: typeof r.buyer_note === 'string' ? r.buyer_note : null,
    created_at: num(r.created_at) ?? 0,
    updated_at: num(r.updated_at) ?? 0,
    lottery: Array.isArray(r.lottery)
      ? (r.lottery as Record<string, unknown>[])
          .filter((e) => e && typeof e === 'object' && typeof e.key === 'string')
          .map((e) => ({
            key: String(e.key),
            kind: e.kind === 'bonus' ? 'bonus' as const : 'purchase' as const,
            name: typeof e.name === 'string' && e.name ? e.name : String(e.key),
            price: num(e.price) ?? 0,
            qty: num(e.qty) ?? 0,
            result: e.result === 'won' || e.result === 'lost' || e.result === 'void' ? e.result : 'pending' as const,
            drawn_at: num(e.drawn_at),
          }))
      : [],
  };
}

/** 予約者による個数の修正（受け取り済みになるまで・増減とも）。
 *  `items` は抽選以外の行の {key, qty}。qty 0 は行を消す。上限はサーバーが再検査する。 */
export async function updateReservationQty(
  slug: string,
  reservationId: string,
  installId: string,
  items: { key: string; qty: number }[],
): Promise<UpdateReservationQtyResult> {
  const { data, error } = await supabase.rpc('update_reservation_qty', {
    p_slug: slug,
    p_reservation_id: reservationId,
    p_installation_id: installId,
    p_items: items,
  });
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as Record<string, unknown>;
  return { items: normalizeItems(r.items), total_price: num(r.total_price) ?? 0 };
}

function normalizeItems(v: unknown): MyReservationItem[] {
  if (!Array.isArray(v)) return [];
  const out: MyReservationItem[] = [];
  for (const raw of v as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object' || typeof raw.key !== 'string') continue;
    const it: MyReservationItem = {
      key: raw.key,
      name: typeof raw.name === 'string' && raw.name ? raw.name : raw.key,
      price: num(raw.price) ?? 0,
      qty: num(raw.qty) ?? 0,
    };
    if (raw.lottery === 'purchase' || raw.lottery === 'bonus') it.lottery = raw.lottery;
    out.push(it);
  }
  return out;
}
