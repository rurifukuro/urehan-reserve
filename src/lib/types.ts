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
}

// 公開お品書きの1品目（reservation_pages.items のスナップショット要素）。
export interface PageItem {
  key: string;
  name: string;
  price: number;
  kind: 'product' | 'bundle';
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
