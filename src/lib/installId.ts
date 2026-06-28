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

export function getInstallId(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const id = uuidv4();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    // localStorage 不可（プライベートブラウズ等）。セッション内一意でフォールバック。
    return uuidv4();
  }
}
