// 買い手端末のランダムID（本人キャンセルの照合専用・個人を特定しない）。localStorage に永続化。
const KEY = 'urehan_reserve_install_id_v1';

function uuidv4(): string {
  // crypto.randomUUID があれば使う。無い環境は Math.random フォールバック（識別子用途のみ）。
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 送信ごとに1個作る冪等キー（migration 0062 の `p_request_id`）。永続化しない。 */
export function newRequestId(): string {
  return uuidv4();
}

/** 端末IDと、それを**永続化できたかどうか**。
 *  🔴 Rev84（ラウンド16・班E 要確認8）: 旧実装は保存失敗を黙って握り、毎回別の UUID を返していた。
 *    `cancel_reservation` は installation_id 一致が条件なので、この端末は
 *    **リロードした瞬間に自分の取り置きを取り消せなくなる**（取り消しボタンも復元されない）。
 *    買い手は「行けなくなったので取り消したい」を実行できず、売り手は当日まで在庫を握り続ける。
 *    直せない環境の制約（プライベートブラウズ等）なので**動作は変えず**、
 *    「できない」ことを画面で伝えられるように `persisted` を返す（無反応にしない）。 */
export interface InstallIdState {
  id: string;
  /** localStorage へ書けた（＝再訪しても同じIDで取り消せる）か。 */
  persisted: boolean;
}

export function getInstallIdState(): InstallIdState {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return { id: existing, persisted: true };
    const id = uuidv4();
    localStorage.setItem(KEY, id);
    // 書けたつもりでも容量0の実装があるので、読み直して実際に残ったかまで確かめる。
    return { id, persisted: localStorage.getItem(KEY) === id };
  } catch {
    // localStorage 不可（プライベートブラウズ等）。セッション内一意でフォールバック。
    return { id: uuidv4(), persisted: false };
  }
}

/** 後方互換（ID だけ要る呼び出し用）。 */
export function getInstallId(): string {
  return getInstallIdState().id;
}
