import { supabase } from './supabase';
import type { ReservationPage, ReservedItem, CreateReservationResult } from './types';

// slug からお品書きページを取得（security definer RPC・owner_token_hash は返らない）。
// 集合返し関数なので戻りは配列。先頭行を返す（無ければ null）。
export async function getReservationPage(slug: string): Promise<ReservationPage | null> {
  const { data, error } = await supabase.rpc('get_reservation_page', { p_slug: slug });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ReservationPage[];
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    items: Array.isArray(row.items) ? row.items : [],
    oshinagaki_urls: Array.isArray(row.oshinagaki_urls) ? row.oshinagaki_urls : [],
  };
}

// 予約を作成して受取番号を採番。合計はサーバー側で再計算される（クライアント値は信用されない）。
export async function createReservation(
  slug: string,
  nickname: string,
  installId: string,
  items: ReservedItem[],
): Promise<CreateReservationResult> {
  const { data, error } = await supabase.rpc('create_reservation', {
    p_slug: slug,
    p_nickname: nickname,
    p_installation_id: installId,
    p_items: items,
    p_now: Date.now(),
  });
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
