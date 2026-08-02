import { createClient } from '@supabase/supabase-js';
import { timeoutFetch } from './fetchTimeout';

// URL / anon(publishable) キーは公開安全値（RLS 前提）。未設定でも画面は出すが RPC は失敗する。
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const hasSupabaseConfig = !!(supabaseUrl && supabaseAnonKey);

if (!hasSupabaseConfig) {
  console.error(
    '[urehan-reserve] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が未設定です。' +
      '.env.example をコピーして .env を作成してください。',
  );
}

function originOf(url: string): string | null {
  const m = /^(https?:\/\/[^/?#]+)/i.exec(url);
  // `noUncheckedIndexedAccess` 下では m[1] も undefined 候補になる（キャプチャ必須の正規表現でも）。
  const origin = m?.[1];
  return origin ? origin.toLowerCase() : null;
}

/** 🔴 Rev87（批判的チェック ラウンド18・班J 重要 J-1／DEEPLINK-1・FIX-SPREAD）:
 *  その URL が**このサーバー**（`VITE_SUPABASE_URL`）のものか。
 *
 *  お品書き画像の URL は `reservation_pages.oshinagaki_urls` に入っている値で、
 *  この列は **anon が RPC 経由で書ける**（未使用 slug なら誰でもページを作れる）。
 *  ＝サーバーを信用して `<img src>` に流すと、公開ページを開いた買い手全員の
 *  IP・時刻・UA が第三者のサーバーへ渡り、画像の中身も攻撃者がいつでも差し替えられる。
 *
 *  サーバー側にも同じ検査を置いた（migration 0064(A)）が、**両側に置く**のが正しい:
 *  サーバーの述語は 0063 で一度壊れており（数え方式が `//evil.example/…` を通していた）、
 *  クライアントが素通しだとその穴がそのまま画面に出る。
 *  姉妹アプリ とれはんっ！は同じ RPC を叩く際に `isTrustedSupabaseUrl`
 *  （`とれはんっ！/src/services/sync/supabaseClient.ts:44-49`）で濾していて、
 *  **この Web だけが検証していなかった**。 */
export function isTrustedStorageUrl(url: string): boolean {
  if (!supabaseUrl || !url) return false;
  const expected = originOf(supabaseUrl);
  const actual = originOf(url);
  return !!expected && !!actual && expected === actual;
}

// 匿名モデル＝Auth セッションを持たない（取り置きページは slug + RPC だけで成立する）。
export const supabase = createClient(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder',
  {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    // 🔴 Rev84（ラウンド16・班E 重要2／NET-TIMEOUT）: supabase-js は既定でタイムアウトを持たない。
    //   会場回線の「繋がっているのに返ってこない」状態で、読み込みスピナーと「送信中…」が
    //   永久に固まる。ここに1回差し込めば、この Web の全 RPC が制限時間つきになる
    //   （呼び出し側ごとの書き漏れが原理的に起きない）。本体アプリ側と同じ設計。
    global: { fetch: timeoutFetch() },
  },
);
