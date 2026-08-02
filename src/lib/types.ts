// 取り置きページ（get_reservation_page RPC の戻り行）。owner_token_hash は返らない（買い手は知り得ない）。
export interface ReservationPage {
  id: string;
  slug: string;
  event_id: string;
  day: number;
  circle_name: string;
  author_name: string;
  space: string;
  items: PageItem[];
  oshinagaki_urls: string[];
  note: string;
  is_open: boolean;
  close_at: number | null;
  has_password: boolean;
  max_reservations: number | null;
}

// 公開お品書きの1品目（reservation_pages.items のスナップショット要素）。
export interface PageItem {
  key: string;
  name: string;
  price: number;
  kind: 'product' | 'bundle';
  limitPerPerson?: number | null;
  // 🔴 Rev86（レジさぽっ！ 批判的チェック ラウンド17・重要 I-4／migration 0064(B)／ORPHAN-1）:
  //   `maxQty`（頒布上限＝在庫数）を削除した。0027 で「サークル内部情報だから買い手に見せない」と
  //   決めたのに `get_reservation_page` が items を無加工で返していた＝ DevTools から在庫数が読めた。
  //   サーバー側（0064(B)）で列ごと落としたので、型にだけ残っていると「来るはず」の誤解を招く。
  //   買い手側のステッパー上限は `limitPerPerson`（無ければ 99）だけで決まる（ReservePage.tsx:96-99）。
}

// 買い手が予約する1品目（create_reservation の p_items 要素）。
export interface ReservedItem {
  key: string;
  name: string;
  price: number;
  qty: number;
}

// create_reservation RPC の戻り行。
export interface CreateReservationResult {
  reservation_id: string;
  pickup_no: number;
}
