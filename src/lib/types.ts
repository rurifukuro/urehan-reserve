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

// ── 0158: 取り置き限定の抽選 ─────────────────────────────────────────

/** 抽選の種類。purchase＝購入権（当選者だけ取り置きできる）／bonus＝おまけ（無料で当たる）。 */
export type LotteryKind = 'purchase' | 'bonus';

/** get_reservation_lottery_public の1要素（予約ページに出す抽選の設定）。
 *  🔴 応募数は**サーバーが返さない**（決定19）＝この型にも持たせない。`winners` は設定した当選数。 */
export interface LotteryPublicItem {
  key: string;
  kind: LotteryKind;
  /** おまけだけ。optin＝「応募する」を選んだ人／holders＝指定した商品を取り置きした人（自動応募）。 */
  bonusTarget: 'optin' | 'holders' | null;
  bonusSourceKeys: string[];
  winners: number;
  qtyPerWinner: number;
  /** page＝予約ページの締切に合わせる／at＝日時を指定（deadlineAt）。 */
  deadlineMode: 'page' | 'at';
  deadlineAt: number | null;
  drawn: boolean;
  drawnAt: number | null;
}

/** 抽選の応募の結果。void＝無効（設定の変更・取り置きの取り消しで外れた応募）。 */
export type LotteryResult = 'pending' | 'won' | 'lost' | 'void';

/** get_my_reservation の lottery の1要素（自分の応募）。 */
export interface MyLotteryEntry {
  key: string;
  kind: LotteryKind;
  name: string;
  price: number;
  qty: number;
  result: LotteryResult;
  drawn_at: number | null;
}

/** 取り置きの商品の行。抽選の当選分は `lottery` に種類が入る（個数の修正では触れない印）。 */
export interface MyReservationItem extends ReservedItem {
  lottery?: LotteryKind;
}

export type ReservationStatus = 'pending' | 'collected' | 'cancelled';

/** get_my_reservation の戻り値（自分の取り置き＋抽選の結果）。 */
export interface MyReservation {
  reservation_id: string;
  pickup_no: number;
  nickname: string;
  items: MyReservationItem[];
  total_price: number;
  status: ReservationStatus;
  buyer_note: string | null;
  created_at: number;
  updated_at: number;
  lottery: MyLotteryEntry[];
}

/** update_reservation_qty の戻り値。 */
export interface UpdateReservationQtyResult {
  items: MyReservationItem[];
  total_price: number;
}
